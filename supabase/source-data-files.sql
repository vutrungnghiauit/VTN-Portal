-- Private bucket for original files uploaded in the Source Data module.
-- Run workspace.sql and security.sql first, then run this script in the Supabase SQL Editor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vtn-source-files', 'vtn-source-files', false, 52428800, null)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Survey result attachments are private to their uploader and system admins.
create or replace function public.is_private_source_file(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  metadata public.workspace_records%rowtype;
begin
  select * into metadata
  from public.workspace_records w
  where w.module_key = 'source-data-files'
    and w.data ->> 'storagePath' = p_path
    and w.deleted_at is null
  limit 1;
  if not found then return false; end if;
  return metadata.data ? 'supportTicketId'
    or coalesce(metadata.data ->> 'privateOwnerOnly', 'false') = 'true'
    or coalesce(metadata.data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"';
end;
$$;
revoke all on function public.is_private_source_file(text) from public, anon;
grant execute on function public.is_private_source_file(text) to authenticated;

create or replace function public.can_read_source_file(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  metadata public.workspace_records%rowtype;
  private_file boolean;
begin
  if not public.can_access_module('source-data', 'read') then return false; end if;
  select * into metadata
  from public.workspace_records w
  where w.module_key = 'source-data-files'
    and w.data ->> 'storagePath' = p_path
    and w.deleted_at is null
  limit 1;
  if not found then return false; end if;
  -- Ticket images are authorized by ticket participants, not general source-data access.
  if metadata.data ? 'supportTicketId' then return false; end if;
  private_file := coalesce(metadata.data ->> 'privateOwnerOnly', 'false') = 'true'
    or coalesce(metadata.data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"';
  return not private_file or metadata.owner_id = (select auth.uid()) or public.is_system_admin();
end;
$$;
revoke all on function public.can_read_source_file(text) from public, anon;
grant execute on function public.can_read_source_file(text) to authenticated;

-- Module imports are also archived in this bucket even when the uploader is
-- not allowed to open the administration menu for Source Data.
create or replace function public.can_archive_import_file()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare target_module text;
begin
  if public.can_access_module('source-data', 'create') or public.can_access_module('source-data', 'update') then return true; end if;
  foreach target_module in array array['academic-years','semesters','timetables','students','teaching-plans','calendar','grades','surveys','academic-ai','backup'] loop
    if public.can_access_module(target_module,'create') and public.can_access_module(target_module,'update') then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.can_archive_import_file() from public, anon;
grant execute on function public.can_archive_import_file() to authenticated;

drop policy if exists "Users read own source files" on storage.objects;
create policy "Users read own source files"
on storage.objects for select to authenticated
using (bucket_id = 'vtn-source-files' and public.can_read_source_file(name));

drop policy if exists "Users upload own source files" on storage.objects;

drop policy if exists "Users delete own source files" on storage.objects;

-- Share attachments with users who have Source Data permissions while retaining uploader-specific paths.
drop policy if exists "Source data readers can read shared files" on storage.objects;
create policy "Source data readers can read shared files"
on storage.objects for select to authenticated
using (bucket_id = 'vtn-source-files' and public.can_read_source_file(name));

drop policy if exists "Source data users can upload files" on storage.objects;
create policy "Source data users can upload files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vtn-source-files'
  and (public.can_access_module('source-data', 'create') or public.can_access_module('source-data', 'update') or public.can_archive_import_file())
  and (storage.foldername(name))[2] is null
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.can_access_module('source-data', 'delete')
  )
);

drop policy if exists "Source data managers can remove files" on storage.objects;
create policy "Source data managers can remove files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vtn-source-files'
  and (
    exists (
      select 1 from public.workspace_records w
      where w.module_key = 'source-data-files' and w.data ->> 'storagePath' = name
        and w.deleted_at is not null and not (w.data ? 'supportTicketId')
        and public.can_access_module('trash', 'delete') and public.can_access_module('source-data', 'delete')
        and (not (coalesce(w.data ->> 'privateOwnerOnly', 'false') = 'true' or coalesce(w.data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"') or w.owner_id = (select auth.uid()) or public.is_system_admin())
    )
    or (
      not exists (select 1 from public.workspace_records w where w.module_key = 'source-data-files' and w.data ->> 'storagePath' = name)
      and not exists (select 1 from public.support_tickets t where t.image_path = name)
      and ((storage.foldername(name))[1] = (select auth.uid())::text and (public.can_access_module('source-data', 'update') or public.can_archive_import_file())
        or public.can_access_module('source-data', 'delete'))
    )
  )
);

-- Attachment metadata is shared separately from the extracted rows, which remain under normal module permissions.
drop policy if exists "Source data readers can read shared file metadata" on public.workspace_records;
create policy "Source data readers can read shared file metadata"
on public.workspace_records for select to authenticated
using (
  module_key = 'source-data-files'
  and public.can_access_module('source-data', 'read')
  and not (data ? 'supportTicketId')
  and (
    not (
      coalesce(data ->> 'privateOwnerOnly', 'false') = 'true'
      or coalesce(data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"'
    )
    or owner_id = (select auth.uid())
    or public.is_system_admin()
  )
);

drop policy if exists "Source data users can add file metadata" on public.workspace_records;
create policy "Source data users can add file metadata"
on public.workspace_records for insert to authenticated
with check (
  module_key = 'source-data-files'
  and owner_id = (select auth.uid())
  and not (data ? 'supportTicketId')
  and (public.can_access_module('source-data', 'create') or public.can_archive_import_file())
);

drop policy if exists "Source data managers can update file metadata" on public.workspace_records;
create policy "Source data managers can update file metadata"
on public.workspace_records for update to authenticated
using (
  module_key = 'source-data-files'
  and not (data ? 'supportTicketId')
  and (
    not (
      coalesce(data ->> 'privateOwnerOnly', 'false') = 'true'
      or coalesce(data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"'
    )
    or owner_id = (select auth.uid())
    or public.is_system_admin()
  )
  and (public.can_access_module('source-data', 'delete') or (owner_id = (select auth.uid()) and public.can_access_module('source-data', 'update')))
)
with check (
  module_key = 'source-data-files'
  and not (data ? 'supportTicketId')
  and (
    not (
      coalesce(data ->> 'privateOwnerOnly', 'false') = 'true'
      or coalesce(data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"'
    )
    or owner_id = (select auth.uid())
    or public.is_system_admin()
  )
  and (public.can_access_module('source-data', 'delete') or (owner_id = (select auth.uid()) and public.can_access_module('source-data', 'update')))
);

drop policy if exists "Source data managers can delete file metadata" on public.workspace_records;
create policy "Source data managers can delete file metadata"
on public.workspace_records for delete to authenticated
using (
  module_key = 'source-data-files'
  and not (data ? 'supportTicketId')
  and (
    not (
      coalesce(data ->> 'privateOwnerOnly', 'false') = 'true'
      or coalesce(data ->> 'extractedClassifications', '') ~ '"categoryKey"\s*:\s*"surveys"'
    )
    or owner_id = (select auth.uid())
    or public.is_system_admin()
  )
  and (public.can_access_module('source-data', 'delete') or (owner_id = (select auth.uid()) and public.can_access_module('source-data', 'update')))
);

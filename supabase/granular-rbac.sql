-- Apply after account-registration.sql, security.sql, rbac-actions.sql,
-- system-settings.sql, source-data-files.sql, academic-ai.sql, support-ticket-workflow.sql,
-- surveys.sql, notifications.sql, and the other module SQL files.
-- Adds group and tab resources to the existing permission matrix and makes
-- group-level read revocation apply to database module policies as well.

alter table public.user_profiles add column if not exists avatar_url text;

alter table public.role_module_permissions
  drop constraint if exists role_module_permissions_action_key_check;
alter table public.user_module_permissions
  drop constraint if exists user_module_permissions_action_key_check;

alter table public.role_module_permissions
  add constraint role_module_permissions_action_key_check
  check (action_key in ('read','create','update','delete','restore','export','backup','import'));
alter table public.user_module_permissions
  add constraint user_module_permissions_action_key_check
  check (action_key in ('read','create','update','delete','restore','export','backup','import'));

insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
select role_key, group_key, 'read', bool_or(allowed)
from public.role_module_permissions permissions
cross join lateral (values (
  case
    when permissions.module_key in ('dashboard','my-profile') then 'group:chung'
    when permissions.module_key in ('academic-years','semesters','timetables','student-records','students','groups','teaching-plans','calendar') then 'group:dao-tao'
    when permissions.module_key in ('grades','assignments','tasks','survey-participation','surveys','academic-ai','random-picker') then 'group:hoc-vu'
    when permissions.module_key in ('student-support','supports','documents','forms-templates') then 'group:ho-tro'
    when permissions.module_key in ('source-data','notifications','announcements','accounts','permissions','audit-logs','backup','trash','settings') then 'group:quan-tri'
    else null
  end
)) as groups(group_key)
where permissions.action_key = 'read' and groups.group_key is not null
group by role_key, group_key
on conflict (role_key,module_key,action_key) do nothing;

-- Keep the student-facing support and survey menus independently configurable
-- while preserving the current role defaults.
insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
select role_key, 'student-support', action_key, allowed
from public.role_module_permissions
where module_key = 'supports'
on conflict (role_key,module_key,action_key) do nothing;

insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
select role_key, 'survey-participation', action_key, allowed
from public.role_module_permissions
where module_key = 'surveys'
on conflict (role_key,module_key,action_key) do nothing;

-- Students can submit and update their own feedback; support staff create
-- tickets for students through the separate management module.
update public.role_module_permissions
set allowed = true
where role_key in ('student','class_president','class_vice')
  and module_key = 'student-support' and action_key = 'create';
update public.role_module_permissions
set allowed = true
where role_key in ('student','class_president','class_vice')
  and module_key = 'survey-participation' and action_key in ('create','update');
update public.role_module_permissions
set allowed = false
where role_key = 'teacher' and module_key in ('backup','audit-logs');
update public.role_module_permissions
set allowed = true
where role_key in ('student','class_president','class_vice') and module_key='my-profile' and action_key='update';

insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
select role_key, tab_key, 'read', allowed
from (
  select role_key, 'tab:student-records:student-profile' as tab_key, allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
  union all select role_key, 'tab:student-records:academic-results', allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
  union all select role_key, 'tab:student-records:study-history', allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
  union all select role_key, 'tab:grades:student-profile', allowed from public.role_module_permissions where module_key='grades' and action_key='read'
  union all select role_key, 'tab:grades:academic-results', allowed from public.role_module_permissions where module_key='grades' and action_key='read'
  union all select role_key, 'tab:grades:study-history', allowed from public.role_module_permissions where module_key='grades' and action_key='read'
  union all select role_key, 'tab:timetables:list', allowed from public.role_module_permissions where module_key='timetables' and action_key='read'
  union all select role_key, 'tab:timetables:week', allowed from public.role_module_permissions where module_key='timetables' and action_key='read'
  union all select role_key, 'tab:calendar:list', allowed from public.role_module_permissions where module_key='calendar' and action_key='read'
  union all select role_key, 'tab:calendar:week', allowed from public.role_module_permissions where module_key='calendar' and action_key='read'
  union all select role_key, 'tab:academic-ai:chat', allowed from public.role_module_permissions where module_key='academic-ai' and action_key='read'
  union all select role_key, 'tab:academic-ai:sources', allowed from public.role_module_permissions where module_key='academic-ai' and action_key='read'
) as tabs
on conflict (role_key,module_key,action_key) do nothing;

create or replace function public.can_access_module(p_module text, p_action text default 'read')
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  caller_status text;
  override_value boolean;
  role_value boolean;
  group_key text;
begin
  if caller is null then return false; end if;
  select role_key, registration_status into caller_role, caller_status from public.user_profiles where user_id = caller;
  if caller_role is null then return false; end if;
  if caller_role = 'super_admin' then return true; end if;
  if coalesce(caller_status, 'pending') <> 'approved' then return false; end if;

  -- Tab resources are first-class permissions. A direct tab check also
  -- requires read access to its parent menu, so a stale tab grant cannot
  -- reopen a menu that has been revoked.
  if p_module like 'tab:%' then
    group_key := split_part(p_module, ':', 2);
    if group_key = '' or not public.can_access_module(group_key, 'read') then return false; end if;
    select allowed into override_value from public.user_module_permissions
      where user_id = caller and module_key = p_module and action_key = p_action;
    if found then return override_value; end if;
    select allowed into role_value from public.role_module_permissions
      where role_key = caller_role and module_key = p_module and action_key = p_action;
    return coalesce(role_value, false);
  end if;

  -- Menu permissions are authoritative. Group toggles cascade to each child
  -- permission in the UI, so a stale group row must not veto a menu grant.
  select allowed into override_value from public.user_module_permissions
    where user_id = caller and module_key = p_module and action_key = p_action;
  if found then return override_value; end if;

  select allowed into role_value from public.role_module_permissions
    where role_key = caller_role and module_key = p_module and action_key = p_action;
  return coalesce(role_value, false);
end;
$$;
grant execute on function public.can_access_module(text,text) to authenticated;

-- Academic AI's chat and source library are separate tabs. The Edge Function
-- uses the same checks before its service-role queries.
drop policy if exists "Academic AI sources are visible to permitted users" on public.academic_ai_sources;
create policy "Academic AI sources are visible to permitted users"
  on public.academic_ai_sources for select to authenticated
  using (public.can_access_module('tab:academic-ai:sources','read'));
drop policy if exists "Academic AI source managers can add sources" on public.academic_ai_sources;
create policy "Academic AI source managers can add sources"
  on public.academic_ai_sources for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and public.can_access_module('tab:academic-ai:sources','read') and public.can_access_module('academic-ai','create'));
drop policy if exists "Academic AI source managers can update sources" on public.academic_ai_sources;
create policy "Academic AI source managers can update sources"
  on public.academic_ai_sources for update to authenticated
  using (public.can_access_module('tab:academic-ai:sources','read') and public.can_access_module('academic-ai','update'))
  with check (public.can_access_module('tab:academic-ai:sources','read') and public.can_access_module('academic-ai','update'));
drop policy if exists "Academic AI source managers can remove sources" on public.academic_ai_sources;
create policy "Academic AI source managers can remove sources"
  on public.academic_ai_sources for delete to authenticated
  using (public.can_access_module('tab:academic-ai:sources','read') and public.can_access_module('academic-ai','delete'));

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); target_role text;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') or not public.can_access_module('accounts','update') then
    raise exception 'Account role update permission required';
  end if;
  if p_role not in ('super_admin','system_admin','sub_admin','teacher','assistant','class_president','class_vice','student') then raise exception 'Invalid account role'; end if;
  select role_key into target_role from public.user_profiles where user_id=p_user_id for update;
  if target_role is null then raise exception 'Account not found'; end if;
  if target_role='super_admin' or p_role='super_admin' then raise exception 'Super Admin role is protected'; end if;
  if caller_role <> 'super_admin' and p_role in ('system_admin','sub_admin') then raise exception 'Only Super Admin may assign administrator roles'; end if;
  update public.user_profiles set role_key=p_role, updated_at=now() where user_id=p_user_id;
end;
$$;
revoke all on function public.set_user_role(uuid,text) from public, anon;
grant execute on function public.set_user_role(uuid,text) to authenticated;

create or replace function public.save_registration_settings(p_enabled boolean, p_approval_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_system_admin() or not public.can_access_module('settings','update') then
    raise exception 'System settings update permission required';
  end if;
  insert into public.account_registration_settings(id,enabled,approval_required,updated_by,updated_at)
  values(true,p_enabled,p_approval_required,(select auth.uid()),now())
  on conflict(id) do update set enabled=excluded.enabled, approval_required=excluded.approval_required,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.save_registration_settings(boolean,boolean) from public, anon;
grant execute on function public.save_registration_settings(boolean,boolean) to authenticated;

create or replace function public.set_current_semester(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare chosen text := nullif(trim(p_name),''); caller uuid := (select auth.uid());
begin
  if caller is null or not (public.can_access_module('semesters','update') or public.can_access_module('settings','update')) then
    raise exception 'Current semester update permission required';
  end if;
  update public.system_settings set data=jsonb_set(data,'{current_semester}',to_jsonb(coalesce(chosen,'')),true),updated_by=caller,updated_at=now() where id=true;
  update public.workspace_records set data=jsonb_set(data,'{current}',to_jsonb(case when chosen is not null and data->>'title'=chosen then 'CÃ³' else 'KhÃ´ng' end),true)
    where module_key='semesters' and deleted_at is null;
end;
$$;
revoke all on function public.set_current_semester(text) from public, anon;
grant execute on function public.set_current_semester(text) to authenticated;

drop policy if exists "Admins read role permissions" on public.role_module_permissions;
create policy "Admins read role permissions" on public.role_module_permissions for select to authenticated
  using (public.is_system_admin() and public.can_access_module('permissions','read'));
drop policy if exists "Admins read user permission overrides" on public.user_module_permissions;
create policy "Admins read user permission overrides" on public.user_module_permissions for select to authenticated
  using (public.is_system_admin() and public.can_access_module('permissions','read'));
drop policy if exists "Users read own profiles and admins read all" on public.user_profiles;
create policy "Users read own profiles and admins read all" on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (public.is_system_admin() and public.can_access_module('accounts','read')));
drop policy if exists "Users update their own profile fields" on public.user_profiles;
create policy "Users update their own profile fields" on public.user_profiles for update to authenticated
using ((user_id=(select auth.uid()) and public.can_access_module('my-profile','update'))
  or (public.is_system_admin() and public.can_access_module('accounts','update')))
with check ((user_id=(select auth.uid()) and public.can_access_module('my-profile','update'))
  or (public.is_system_admin() and public.can_access_module('accounts','update')));

create or replace function public.set_role_module_permission(p_role text, p_module text, p_action text, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key();
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') or not public.can_access_module('permissions','update') then
    raise exception 'Không có quyền cấu hình RBAC';
  end if;
  if p_role = 'super_admin' then raise exception 'Quyền Super Admin luôn bật và không thể chỉnh sửa'; end if;
  if p_action not in ('read','create','update','delete','restore','export') then raise exception 'Loại quyền không hợp lệ'; end if;
  insert into public.role_module_permissions (role_key,module_key,action_key,allowed,updated_at)
  values (p_role,p_module,p_action,p_allowed,now())
  on conflict (role_key,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();
end;
$$;
grant execute on function public.set_role_module_permission(text,text,text,boolean) to authenticated;

create or replace function public.set_user_module_permission(p_user_id uuid, p_module text, p_action text, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); target_role text;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') or not public.can_access_module('permissions','update') then
    raise exception 'Không có quyền cấu hình RBAC';
  end if;
  if p_action not in ('read','create','update','delete','restore','export') then raise exception 'Loại quyền không hợp lệ'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if target_role = 'super_admin' then raise exception 'Quyền Super Admin luôn bật và không thể chỉnh sửa'; end if;
  insert into public.user_module_permissions (user_id,module_key,action_key,allowed,updated_at)
  values (p_user_id,p_module,p_action,p_allowed,now())
  on conflict (user_id,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();
end;
$$;
grant execute on function public.set_user_module_permission(uuid,text,text,boolean) to authenticated;

create or replace function public.get_user_access_matrix(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller_role text := public.current_role_key();
  target_role text;
  permission_json jsonb;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') or not public.can_access_module('permissions','read') then raise exception 'Không có quyền xem ma trận người dùng'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if target_role = 'super_admin' and p_user_id <> (select auth.uid()) then return jsonb_build_object('role',target_role,'superAdmin',true,'permissions','{}'::jsonb); end if;
  select coalesce(jsonb_object_agg(module_key,actions),'{}'::jsonb) into permission_json from (
    select module_key,jsonb_object_agg(action_key,allowed) as actions from (
      select distinct on (module_key,action_key) module_key,action_key,allowed from (
        select module_key,action_key,allowed,0 as priority from public.role_module_permissions where role_key=target_role
        union all select module_key,action_key,allowed,1 as priority from public.user_module_permissions where user_id=p_user_id
      ) as candidates order by module_key,action_key,priority desc
    ) as effective group by module_key
  ) as grouped;
  return jsonb_build_object('role',target_role,'superAdmin',false,'permissions',permission_json);
end;
$$;
grant execute on function public.get_user_access_matrix(uuid) to authenticated;

-- Revoke the owner-only storage policies created by earlier migrations. A
-- module import may archive its original file, but that permission must not
-- grant Source Data browsing or management access.
create or replace function public.can_archive_import_file()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare target_module text;
begin
  if public.can_access_module('source-data','create') or public.can_access_module('source-data','update') then return true; end if;
  foreach target_module in array array['academic-years','semesters','timetables','students','teaching-plans','calendar','grades','surveys','academic-ai','backup'] loop
    if public.can_access_module(target_module,'create') and public.can_access_module(target_module,'update') then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.can_archive_import_file() from public, anon;
grant execute on function public.can_archive_import_file() to authenticated;

drop policy if exists "Recipients read their notifications" on public.app_notifications;
create policy "Recipients read their notifications" on public.app_notifications for select to authenticated
using (public.can_access_module('notifications','read') and exists (select 1 from public.app_notification_recipients r where r.notification_id=id and r.recipient_id=(select auth.uid())));
drop policy if exists "Users read their notification inbox" on public.app_notification_recipients;
create policy "Users read their notification inbox" on public.app_notification_recipients for select to authenticated
using (recipient_id=(select auth.uid()) and public.can_access_module('notifications','read'));
drop policy if exists "Users mark their notifications read" on public.app_notification_recipients;
create policy "Users mark their notifications read" on public.app_notification_recipients for update to authenticated
using (recipient_id=(select auth.uid()) and public.can_access_module('notifications','read'))
with check (recipient_id=(select auth.uid()) and public.can_access_module('notifications','read'));

drop policy if exists "Users read own source files" on storage.objects;
create policy "Users read own source files" on storage.objects for select to authenticated
using (bucket_id = 'vtn-source-files' and public.can_read_source_file(name));
drop policy if exists "Users upload own source files" on storage.objects;
drop policy if exists "Users delete own source files" on storage.objects;
drop policy if exists "Source data readers can read shared files" on storage.objects;
create policy "Source data readers can read shared files" on storage.objects for select to authenticated
using (bucket_id = 'vtn-source-files' and public.can_read_source_file(name));
drop policy if exists "Source data users can upload files" on storage.objects;
create policy "Source data users can upload files" on storage.objects for insert to authenticated
with check (
  bucket_id = 'vtn-source-files'
  and (storage.foldername(name))[2] is null
  and (public.can_access_module('source-data','create') or public.can_access_module('source-data','update') or public.can_archive_import_file())
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_access_module('source-data','delete'))
);
drop policy if exists "Source data managers can remove files" on storage.objects;
create policy "Source data managers can remove files" on storage.objects for delete to authenticated
using (
  bucket_id = 'vtn-source-files'
  and (
    exists (select 1 from public.workspace_records w where w.module_key='source-data-files' and w.data->>'storagePath'=name and w.deleted_at is not null and not (w.data ? 'supportTicketId')
      and public.can_access_module('trash','delete') and public.can_access_module('source-data','delete')
      and (not (coalesce(w.data->>'privateOwnerOnly','false')='true' or coalesce(w.data->>'extractedClassifications','') ~ '"categoryKey"\s*:\s*"surveys"') or w.owner_id=(select auth.uid()) or public.is_system_admin()))
    or (not exists (select 1 from public.workspace_records w where w.module_key='source-data-files' and w.data->>'storagePath'=name)
      and not exists (select 1 from public.support_tickets t where t.image_path=name)
      and ((storage.foldername(name))[1]=(select auth.uid())::text and (public.can_access_module('source-data','update') or public.can_archive_import_file())
        or public.can_access_module('source-data','delete')))
  )
);

drop policy if exists "Source data readers can read shared file metadata" on public.workspace_records;
create policy "Source data readers can read shared file metadata" on public.workspace_records for select to authenticated
using (module_key='source-data-files' and public.can_access_module('source-data','read') and not (data ? 'supportTicketId')
  and (not (coalesce(data->>'privateOwnerOnly','false')='true' or coalesce(data->>'extractedClassifications','') ~ '"categoryKey"\s*:\s*"surveys"')
    or owner_id=(select auth.uid()) or public.is_system_admin()));
drop policy if exists "Source data users can add file metadata" on public.workspace_records;
create policy "Source data users can add file metadata" on public.workspace_records for insert to authenticated
with check (module_key='source-data-files' and owner_id=(select auth.uid()) and not (data ? 'supportTicketId')
  and (public.can_access_module('source-data','create') or public.can_archive_import_file()));
drop policy if exists "Source data managers can update file metadata" on public.workspace_records;
create policy "Source data managers can update file metadata" on public.workspace_records for update to authenticated
using (module_key='source-data-files' and not (data ? 'supportTicketId')
  and (not (coalesce(data->>'privateOwnerOnly','false')='true' or coalesce(data->>'extractedClassifications','') ~ '"categoryKey"\s*:\s*"surveys"') or owner_id=(select auth.uid()) or public.is_system_admin())
  and (public.can_access_module('source-data','delete') or (owner_id=(select auth.uid()) and public.can_access_module('source-data','update'))))
with check (module_key='source-data-files' and not (data ? 'supportTicketId')
  and (public.can_access_module('source-data','delete') or (owner_id=(select auth.uid()) and public.can_access_module('source-data','update'))));
drop policy if exists "Source data managers can delete file metadata" on public.workspace_records;
create policy "Source data managers can delete file metadata" on public.workspace_records for delete to authenticated
using (module_key='source-data-files' and not (data ? 'supportTicketId')
  and (not (coalesce(data->>'privateOwnerOnly','false')='true' or coalesce(data->>'extractedClassifications','') ~ '"categoryKey"\s*:\s*"surveys"') or owner_id=(select auth.uid()) or public.is_system_admin())
  and (public.can_access_module('source-data','delete') or (owner_id=(select auth.uid()) and public.can_access_module('source-data','update'))));

-- The bucket is shared with ticket photos. Keep their uploads, reads and cleanup
-- attached to the matching ticket and the caller's appropriate menu permission.
drop policy if exists "Ticket creators upload their attachments" on storage.objects;
drop policy if exists "Ticket creators upload archived attachments" on storage.objects;
create policy "Ticket creators upload archived attachments" on storage.objects for insert to authenticated
with check (bucket_id='vtn-source-files' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists (select 1 from public.support_tickets t where t.id::text=(storage.foldername(name))[2] and t.image_path is null
    and ((t.created_by=(select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('supports','create'))
      or (t.student_user_id=(select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('student-support','create')))));
drop policy if exists "Ticket creators remove unattached uploads" on storage.objects;
drop policy if exists "Ticket creators remove unattached archived uploads" on storage.objects;
create policy "Ticket creators remove unattached archived uploads" on storage.objects for delete to authenticated
using (bucket_id='vtn-source-files' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists (select 1 from public.support_tickets t where t.id::text=(storage.foldername(name))[2] and t.image_path is null
    and ((t.created_by=(select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('supports','create'))
      or (t.student_user_id=(select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('student-support','create')))));
drop policy if exists "Ticket participants read their attachments" on storage.objects;
drop policy if exists "Ticket participants read archived attachments" on storage.objects;
create policy "Ticket participants read archived attachments" on storage.objects for select to authenticated
using (bucket_id='vtn-source-files' and exists (select 1 from public.support_tickets t where t.image_path=name
  and (((t.student_user_id=(select auth.uid()) or exists (select 1 from public.students s where s.id=t.student_record_id and s.auth_user_id=(select auth.uid())))
        and public.can_access_module('student-support','read'))
    or ((t.teacher_id=(select auth.uid()) or t.created_by=(select auth.uid()) or t.assignee_id=(select auth.uid()) or public.is_system_admin() or public.current_role_key()='assistant')
        and public.can_access_module('supports','read')))));

create or replace function public.reset_role_permissions()
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key();
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') or not public.can_access_module('permissions','update') then raise exception 'Không có quyền khôi phục RBAC'; end if;
  delete from public.role_module_permissions;
  insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
  select r.role_key,m.module_key,a.action_key,
    case
      when r.role_key in ('system_admin','sub_admin') then true
      when r.role_key='teacher' then a.action_key in ('read','create','update','delete','restore','export') and m.module_key not in ('accounts','permissions','settings','backup','audit-logs')
      when r.role_key='assistant' then a.action_key in ('read','create','update') and m.module_key in ('dashboard','students','student-records','semesters','academic-years','timetables','grades','assignments','tasks','groups','teaching-plans','calendar','documents','academic-ai','source-data','student-support','supports','survey-participation','surveys','forms-templates','notifications','random-picker','my-profile','trash')
      when r.role_key in ('class_president','class_vice') then (a.action_key in ('read','create') or (a.action_key='update' and m.module_key in ('random-picker','survey-participation'))) and m.module_key in ('dashboard','student-records','assignments','tasks','groups','calendar','documents','student-support','supports','survey-participation','surveys','notifications','my-profile','random-picker')
      when r.role_key='student' then (a.action_key='read' or (a.action_key='create' and m.module_key in ('groups','student-support','survey-participation')) or (a.action_key in ('create','update') and m.module_key in ('random-picker','survey-participation'))) and m.module_key in ('dashboard','student-records','assignments','documents','academic-ai','student-support','supports','survey-participation','surveys','notifications','forms-templates','my-profile','random-picker','groups')
      else false
    end
  from (values ('system_admin'),('sub_admin'),('teacher'),('assistant'),('class_president'),('class_vice'),('student')) as r(role_key)
  cross join (values ('dashboard'),('academic-years'),('semesters'),('timetables'),('students'),('student-records'),('groups'),('teaching-plans'),('calendar'),('grades'),('assignments'),('tasks'),('student-support'),('academic-ai'),('documents'),('source-data'),('forms-templates'),('survey-participation'),('surveys'),('notifications'),('announcements'),('supports'),('random-picker'),('my-profile'),('accounts'),('permissions'),('audit-logs'),('backup'),('trash'),('settings')) as m(module_key)
  cross join (values ('read'),('create'),('update'),('delete'),('restore'),('export')) as a(action_key);

  insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
  select role_key, group_key, 'read', bool_or(allowed)
  from public.role_module_permissions permissions
  cross join lateral (values (
    case
      when permissions.module_key in ('dashboard','my-profile') then 'group:chung'
      when permissions.module_key in ('academic-years','semesters','timetables','student-records','students','groups','teaching-plans','calendar') then 'group:dao-tao'
      when permissions.module_key in ('grades','assignments','tasks','survey-participation','surveys','academic-ai','random-picker') then 'group:hoc-vu'
      when permissions.module_key in ('student-support','supports','documents','forms-templates') then 'group:ho-tro'
      when permissions.module_key in ('source-data','notifications','announcements','accounts','permissions','audit-logs','backup','trash','settings') then 'group:quan-tri'
      else null
    end
  )) as groups(group_key)
  where permissions.action_key='read' and groups.group_key is not null
  group by role_key,group_key;

  insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
  select role_key,tab_key,'read',allowed from (
    select role_key,'tab:student-records:student-profile' as tab_key,allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
    union all select role_key,'tab:student-records:academic-results',allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
    union all select role_key,'tab:student-records:study-history',allowed from public.role_module_permissions where module_key='student-records' and action_key='read'
    union all select role_key,'tab:grades:student-profile',allowed from public.role_module_permissions where module_key='grades' and action_key='read'
    union all select role_key,'tab:grades:academic-results',allowed from public.role_module_permissions where module_key='grades' and action_key='read'
    union all select role_key,'tab:grades:study-history',allowed from public.role_module_permissions where module_key='grades' and action_key='read'
    union all select role_key,'tab:timetables:list',allowed from public.role_module_permissions where module_key='timetables' and action_key='read'
    union all select role_key,'tab:timetables:week',allowed from public.role_module_permissions where module_key='timetables' and action_key='read'
    union all select role_key,'tab:calendar:list',allowed from public.role_module_permissions where module_key='calendar' and action_key='read'
    union all select role_key,'tab:calendar:week',allowed from public.role_module_permissions where module_key='calendar' and action_key='read'
    union all select role_key,'tab:academic-ai:chat',allowed from public.role_module_permissions where module_key='academic-ai' and action_key='read'
    union all select role_key,'tab:academic-ai:sources',allowed from public.role_module_permissions where module_key='academic-ai' and action_key='read'
  ) as tabs;
end;
$$;

-- Keep support tickets scoped to the permissions for the student-facing form
-- and the staff-facing manager, including event history and pending edits.
drop policy if exists "Ticket parties and admins can read" on public.support_tickets;
drop policy if exists "Ticket parties and authorized staff can read" on public.support_tickets;
create policy "Ticket parties and authorized staff can read" on public.support_tickets for select to authenticated
using (
  ((student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid())))
    and public.can_access_module('student-support','read'))
  or ((teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
    or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','read'))
);

drop policy if exists "Teacher updates assigned ticket status" on public.support_tickets;
drop policy if exists "Ticket parties and staff can update" on public.support_tickets;
create policy "Ticket parties and staff can update" on public.support_tickets for update to authenticated
using (
  ((teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
    or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or ((student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid())))
    and status = 'pending' and public.can_access_module('student-support','update'))
)
with check (
  ((teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
    or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or ((student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid())))
    and status = 'pending' and public.can_access_module('student-support','update'))
);

-- The student creation RPC is SECURITY DEFINER, so check its caller in a
-- trigger before the insert reaches the database.
create or replace function public.check_student_support_create_permission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() in ('student','class_president','class_vice')
    and not public.can_access_module('student-support','create') then
    raise exception 'Student support creation permission required';
  end if;
  return new;
end;
$$;
drop trigger if exists support_ticket_create_permission on public.support_tickets;
create trigger support_ticket_create_permission before insert on public.support_tickets
for each row execute function public.check_student_support_create_permission();

-- Survey definitions are visible to their owners/admins and authorized
-- participants. Response rows and uploads use participation create/update
-- rights, while result visibility stays under survey management rights.
drop policy if exists "Survey users read shared survey definitions" on public.workspace_records;
drop policy if exists "Survey editors read owned or all definitions" on public.workspace_records;
create policy "Survey editors read owned or all definitions" on public.workspace_records for select to authenticated
using (
  module_key = 'surveys' and deleted_at is null
  and (
    (public.is_system_admin() and public.can_access_module('surveys','read'))
    or (owner_id = (select auth.uid()) and public.current_role_key() in ('teacher','assistant') and public.can_access_module('surveys','read'))
    or (public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('survey-participation','read')
      and lower(coalesce(data ->> 'audience','student')) not like '%giáº£ng viÃªn%'
      and lower(coalesce(data ->> 'audience','student')) not like '%faculty%')
  )
);

drop policy if exists "Respondents read their survey ratings" on public.survey_responses;
drop policy if exists "Respondents read their survey responses" on public.survey_responses;
create policy "Respondents read their survey responses" on public.survey_responses for select to authenticated
using (respondent_id = (select auth.uid()) and public.can_access_module('survey-participation','read'));
drop policy if exists "Survey editors read all responses" on public.survey_responses;
drop policy if exists "Survey owners and admins read responses" on public.survey_responses;
create policy "Survey owners and admins read responses" on public.survey_responses for select to authenticated
using (exists (
  select 1 from public.workspace_records s where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
    and public.can_access_module('surveys','read')
    and (public.is_system_admin() or (s.owner_id = (select auth.uid()) and public.current_role_key() in ('teacher','assistant')))
));

drop policy if exists "Respondents submit their survey ratings" on public.survey_responses;
drop policy if exists "Respondents submit survey responses" on public.survey_responses;
create policy "Respondents submit survey responses" on public.survey_responses for insert to authenticated
with check (
  respondent_id = (select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice')
  and public.can_access_module('survey-participation','create')
  and exists (select 1 from public.workspace_records s where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
    and lower(coalesce(s.data ->> 'status','')) not in ('closed','completed','Ä‘Ã£ káº¿t thÃºc','Ä‘Ã£ Ä‘Ã³ng','hoÃ n thÃ nh')
    and lower(coalesce(s.data ->> 'audience','student')) not like '%giáº£ng viÃªn%'
    and lower(coalesce(s.data ->> 'audience','student')) not like '%faculty%'
    and (nullif(s.data ->> 'dueDate','') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD')))
);

drop policy if exists "Respondents update their survey ratings" on public.survey_responses;
drop policy if exists "Respondents update survey responses" on public.survey_responses;
create policy "Respondents update survey responses" on public.survey_responses for update to authenticated
using (respondent_id = (select auth.uid()) and public.can_access_module('survey-participation','update'))
with check (
  respondent_id = (select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice')
  and public.can_access_module('survey-participation','update')
  and exists (select 1 from public.workspace_records s where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
    and lower(coalesce(s.data ->> 'status','')) not in ('closed','completed','Ä‘Ã£ káº¿t thÃºc','Ä‘Ã£ Ä‘Ã³ng','hoÃ n thÃ nh')
    and lower(coalesce(s.data ->> 'audience','student')) not like '%giáº£ng viÃªn%'
    and lower(coalesce(s.data ->> 'audience','student')) not like '%faculty%'
    and (nullif(s.data ->> 'dueDate','') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD')))
);

drop policy if exists "Survey respondents upload answer files" on storage.objects;
create policy "Survey respondents upload answer files" on storage.objects for insert to authenticated
with check (bucket_id = 'vtn-survey-response-files' and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('survey-participation','create')
  and exists (select 1 from public.workspace_records s where s.id::text = (storage.foldername(name))[1] and s.module_key = 'surveys' and s.deleted_at is null
    and lower(coalesce(s.data ->> 'status','')) not in ('closed','completed','Ä‘Ã£ káº¿t thÃºc','Ä‘Ã£ Ä‘Ã³ng','hoÃ n thÃ nh')
    and (nullif(s.data ->> 'dueDate','') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD'))));

drop policy if exists "Survey respondents delete own answer files" on storage.objects;
create policy "Survey respondents delete own answer files" on storage.objects for delete to authenticated
using (bucket_id = 'vtn-survey-response-files' and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.can_access_module('survey-participation','update')
  and exists (select 1 from public.workspace_records s where s.id::text = (storage.foldername(name))[1] and s.module_key = 'surveys' and s.deleted_at is null
    and lower(coalesce(s.data ->> 'status','')) not in ('closed','completed','Ä‘Ã£ káº¿t thÃºc','Ä‘Ã£ Ä‘Ã³ng','hoÃ n thÃ nh')
    and (nullif(s.data ->> 'dueDate','') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD'))));

create or replace function public.get_survey_rating_summary()
returns table (average_rating numeric, response_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_role_key() not in ('super_admin','system_admin','sub_admin','teacher','assistant')
    or not public.can_access_module('surveys','read') then
    return query select 0::numeric, 0::bigint;
    return;
  end if;
  return query select coalesce(round(avg(r.rating)::numeric,1),0::numeric), count(*)::bigint
    from public.survey_responses r join public.workspace_records s on s.id = r.survey_id
    where s.module_key = 'surveys' and s.deleted_at is null
      and (public.is_system_admin() or (s.owner_id = (select auth.uid()) and public.current_role_key() in ('teacher','assistant')));
end;
$$;
revoke all on function public.get_survey_rating_summary() from public, anon;
grant execute on function public.get_survey_rating_summary() to authenticated;

-- Let each signed-in account receive only its role rows and its own overrides
-- so the application can immediately refresh the visible navigation/actions.
drop policy if exists "Admins read role permissions" on public.role_module_permissions;
create policy "Admins read role permissions" on public.role_module_permissions for select to authenticated
using (role_key = public.current_role_key() or (public.is_system_admin() and public.can_access_module('permissions','read')));
drop policy if exists "Admins read user permission overrides" on public.user_module_permissions;
create policy "Admins read user permission overrides" on public.user_module_permissions for select to authenticated
using (user_id = (select auth.uid()) or (public.is_system_admin() and public.can_access_module('permissions','read')));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'role_module_permissions') then
    alter publication supabase_realtime add table public.role_module_permissions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_module_permissions') then
    alter publication supabase_realtime add table public.user_module_permissions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_profiles') then
    alter publication supabase_realtime add table public.user_profiles;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is unavailable; enable the permission tables in Supabase Database publications.';
end;
$$;


-- Secure the system snapshot list and restore RPC with their own permissions.
drop policy if exists "Admins read system backups" on public.system_backups;
create policy "Admins read system backups" on public.system_backups for select to authenticated
using (public.is_system_admin() and public.can_access_module('backup','read'));

create or replace function public.restore_system_settings_backup(p_backup_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); old_data jsonb; restore_data jsonb;
begin
  if not public.is_system_admin() or not public.can_access_module('backup','restore') or not public.can_access_module('settings','update') then
    raise exception 'System backup restore permission required';
  end if;
  select data into old_data from public.system_settings where id = true for update;
  select snapshot -> 'settings' into restore_data from public.system_backups where id = p_backup_id;
  if restore_data is null then raise exception 'Settings backup not found'; end if;
  insert into public.system_backups (created_by,reason,snapshot)
    values (caller,'Automatic snapshot before rollback',jsonb_build_object('settings',old_data));
  update public.system_settings set data = restore_data, updated_by = caller, updated_at = now() where id = true;
end;
$$;
revoke all on function public.restore_system_settings_backup(uuid) from public, anon;
grant execute on function public.restore_system_settings_backup(uuid) to authenticated;

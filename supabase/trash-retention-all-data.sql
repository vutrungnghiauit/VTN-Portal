-- Run after security.sql, granular-rbac.sql, workspace.sql, students.sql, trash-retention.sql,
-- source-data-files.sql, support-tickets.sql, support-ticket-workflow.sql, support-ticket-management.sql,
-- random-picker.sql, notifications.sql, academic-ai.sql, audit.sql and system-settings.sql.
-- Applies the configured retention period to the remaining user-deletable records.

create table if not exists public.system_trash_registry (
  entity_type text not null,
  entity_id text not null,
  module_key text not null,
  record_label text not null default 'Bản ghi',
  owner_id uuid,
  deleted_at timestamptz not null,
  purge_at timestamptz not null,
  primary key (entity_type, entity_id)
);
create index if not exists system_trash_registry_expiry_idx on public.system_trash_registry(purge_at);
alter table public.system_trash_registry enable row level security;
revoke all on public.system_trash_registry from anon, authenticated;

alter table public.random_picker_history add column if not exists deleted_at timestamptz;
alter table public.random_picker_history add column if not exists purge_at timestamptz;
alter table public.random_picker_topics add column if not exists deleted_at timestamptz;
alter table public.random_picker_topics add column if not exists purge_at timestamptz;
alter table public.random_picker_questions add column if not exists deleted_at timestamptz;
alter table public.random_picker_questions add column if not exists purge_at timestamptz;
alter table public.academic_ai_sources add column if not exists deleted_at timestamptz;
alter table public.academic_ai_sources add column if not exists purge_at timestamptz;
alter table public.app_notifications add column if not exists deleted_at timestamptz;
alter table public.app_notifications add column if not exists purge_at timestamptz;
alter table public.system_audit_logs add column if not exists deleted_at timestamptz;
alter table public.system_audit_logs add column if not exists purge_at timestamptz;
alter table public.system_backups add column if not exists deleted_at timestamptz;
alter table public.system_backups add column if not exists purge_at timestamptz;
alter table public.user_profiles add column if not exists deleted_at timestamptz;
alter table public.user_profiles add column if not exists purge_at timestamptz;
alter table public.user_profiles add column if not exists trash_previous_banned_until timestamptz;

drop policy if exists "Permitted users read random history" on public.random_picker_history;
drop policy if exists "Permitted users read random history" on public.random_picker_history;
create policy "Permitted users read random history" on public.random_picker_history for select to authenticated
  using (deleted_at is null and public.can_access_module('random-picker','read') and (owner_id=(select auth.uid()) or public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant')));
drop policy if exists "Permitted users delete random history" on public.random_picker_history;
drop policy if exists "Users delete own random history" on public.random_picker_history;
create policy "Permitted users delete random history" on public.random_picker_history for delete to authenticated
  using (deleted_at is not null and public.can_access_module('random-picker','delete') and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant'));
drop policy if exists "Permitted users read random question bank" on public.random_picker_topics;
create policy "Permitted users read random question bank" on public.random_picker_topics for select to authenticated
  using (deleted_at is null and public.can_access_module('random-picker','read'));
drop policy if exists "Permitted users read random questions" on public.random_picker_questions;
create policy "Permitted users read random questions" on public.random_picker_questions for select to authenticated
  using (deleted_at is null and exists(select 1 from public.random_picker_topics t where t.id=topic_id and t.deleted_at is null) and public.can_access_module('random-picker','read'));
drop policy if exists "Permitted staff delete random question topics" on public.random_picker_topics;
create policy "Permitted staff delete random question topics" on public.random_picker_topics for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete'));
drop policy if exists "Permitted staff delete random questions" on public.random_picker_questions;
create policy "Permitted staff delete random questions" on public.random_picker_questions for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete'));
drop policy if exists "Teachers can permanently delete their trashed students" on public.students;
create policy "Teachers can permanently delete their trashed students" on public.students for delete to authenticated
  using ((owner_id=(select auth.uid()) or public.is_system_admin()) and deleted_at is not null and public.can_access_module('students','delete') and public.can_access_module('trash','delete'));
drop policy if exists "Teachers can delete their own trashed workspace records" on public.workspace_records;
create policy "Teachers can delete their own trashed workspace records" on public.workspace_records for delete to authenticated
  using ((owner_id=(select auth.uid()) or public.is_system_admin()) and deleted_at is not null and public.can_access_module(module_key,'delete') and public.can_access_module('trash','delete'));
drop policy if exists "Staff permanently delete trashed tickets" on public.support_tickets;
create policy "Staff permanently delete trashed tickets" on public.support_tickets for delete to authenticated
  using (deleted_at is not null and public.can_access_module('supports','delete') and public.can_access_module('trash','delete') and (teacher_id=(select auth.uid()) or public.is_system_admin() or public.current_role_key()='assistant'));
drop policy if exists "Permitted users delete random history" on public.random_picker_history;
create policy "Permitted users delete random history" on public.random_picker_history for delete to authenticated
  using (deleted_at is not null and public.can_access_module('random-picker','delete') and public.can_access_module('trash','delete') and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant'));
drop policy if exists "Permitted staff delete random question topics" on public.random_picker_topics;
create policy "Permitted staff delete random question topics" on public.random_picker_topics for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete') and public.can_access_module('trash','delete'));
drop policy if exists "Permitted staff delete random questions" on public.random_picker_questions;
create policy "Permitted staff delete random questions" on public.random_picker_questions for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete') and public.can_access_module('trash','delete'));
drop policy if exists "Source data managers can remove files" on storage.objects;
create policy "Source data managers can remove files" on storage.objects for delete to authenticated
  using (
    bucket_id='vtn-source-files'
    and not exists (select 1 from public.support_tickets t where t.image_path=name)
    and not exists (select 1 from public.workspace_records w where w.module_key='source-data-files' and w.data->>'storagePath'=name and w.data ? 'supportTicketId')
    and (
      exists (
        select 1 from public.workspace_records w
        where w.module_key='source-data-files' and w.data->>'storagePath'=name and w.deleted_at is not null
          and public.can_access_module('trash','delete') and public.can_access_module('source-data','delete')
          and (not (coalesce(w.data->>'privateOwnerOnly','false')='true' or coalesce(w.data->>'extractedClassifications','') ~ '"categoryKey"\s*:\s*"surveys"') or w.owner_id=(select auth.uid()) or public.is_system_admin())
      )
      or (
        not exists (select 1 from public.workspace_records w where w.module_key='source-data-files' and w.data->>'storagePath'=name)
        and ((storage.foldername(name))[1]=(select auth.uid())::text and (public.can_access_module('source-data','update') or public.can_archive_import_file())
          or public.can_access_module('source-data','delete'))
      )
    )
  );
drop policy if exists "Academic AI sources are visible to permitted users" on public.academic_ai_sources;
create policy "Academic AI sources are visible to permitted users" on public.academic_ai_sources for select to authenticated
  using (deleted_at is null and public.can_access_module('academic-ai','read'));
drop policy if exists "Admins read system backups" on public.system_backups;
create policy "Admins read system backups" on public.system_backups for select to authenticated
  using (deleted_at is null and public.is_system_admin());
drop policy if exists "Scoped audit log visibility" on public.system_audit_logs;
create policy "Scoped audit log visibility" on public.system_audit_logs for select to authenticated
  using (deleted_at is null and (public.is_system_admin() or actor_id=(select auth.uid()) or (public.current_role_key()='student' and subject_user_id=(select auth.uid())) or (public.current_role_key()='teacher' and subject_user_id in (select s.auth_user_id from public.students s where s.owner_id=(select auth.uid()) and s.auth_user_id is not null))));
drop policy if exists "Recipients read their notifications" on public.app_notifications;
create policy "Recipients read their notifications" on public.app_notifications for select to authenticated
  using (deleted_at is null and public.can_access_module('notifications','read') and exists(select 1 from public.app_notification_recipients r where r.notification_id=id and r.recipient_id=(select auth.uid())));
drop policy if exists "Users read own profiles and admins read all" on public.user_profiles;
drop policy if exists "Users read own profiles and admins read all" on public.user_profiles;
create policy "Users read own profiles and admins read all" on public.user_profiles for select to authenticated
  using (deleted_at is null and (user_id=(select auth.uid()) or public.is_system_admin()));

create or replace function public.register_system_trash_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_json jsonb;
  entity text;
  module_name text;
  identifier text;
  label text;
  owner_text text;
  deleted_time timestamptz;
  expiry_time timestamptz;
begin
  row_json := to_jsonb(new);
  entity := tg_table_name;
  identifier := coalesce(row_json->>'id', row_json->>'user_id');
  deleted_time := nullif(row_json->>'deleted_at','')::timestamptz;
  if deleted_time is null then
    delete from public.system_trash_registry where entity_type = entity and entity_id = identifier;
    return new;
  end if;
  expiry_time := nullif(row_json->>'purge_at','')::timestamptz;
  if expiry_time is null then
    select deleted_time + make_interval(days => greatest(1, least(coalesce((data->>'trash_retention_days')::integer,30),3650)))
      into expiry_time from public.system_settings where id = true;
    expiry_time := coalesce(expiry_time, deleted_time + interval '30 days');
  end if;
  module_name := case entity
    when 'workspace_records' then coalesce(row_json->>'module_key','workspace_records')
    when 'students' then 'students'
    when 'support_tickets' then 'supports'
    when 'random_picker_history' then 'random-picker'
    when 'random_picker_topics' then 'random-picker'
    when 'random_picker_questions' then 'random-picker'
    when 'academic_ai_sources' then 'academic-ai'
    when 'app_notifications' then 'notifications'
    when 'system_audit_logs' then 'audit-logs'
    when 'system_backups' then 'backup'
    when 'user_profiles' then 'accounts'
    else entity end;
  label := coalesce(nullif(row_json->>'record_label',''), nullif(row_json->>'title',''), nullif(row_json->>'file_name',''),
    nullif(row_json->>'name',''), nullif(row_json->>'question',''), nullif(row_json->>'student_name',''),
    nullif(row_json->>'display_name',''), nullif(row_json->>'username',''), nullif(row_json->>'reason',''),
    nullif(row_json->>'draw_type',''), 'Bản ghi');
  owner_text := coalesce(row_json->>'owner_id', row_json->>'created_by', row_json->>'uploaded_by',
    row_json->>'sender_id', row_json->>'actor_id', row_json->>'teacher_id', row_json->>'student_user_id', row_json->>'user_id');
  insert into public.system_trash_registry(entity_type,entity_id,module_key,record_label,owner_id,deleted_at,purge_at)
  values(entity,identifier,module_name,label,case when owner_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then owner_text::uuid end,deleted_time,expiry_time)
  on conflict(entity_type,entity_id) do update set record_label=excluded.record_label, owner_id=excluded.owner_id, deleted_at=excluded.deleted_at, purge_at=excluded.purge_at;
  return new;
end;
$$;

create or replace function public.clear_system_trash_registry_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.system_trash_registry where entity_type=tg_table_name and entity_id=coalesce(to_jsonb(old)->>'id',to_jsonb(old)->>'user_id');
  return old;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'workspace_records','students','support_tickets','random_picker_history','random_picker_topics',
    'random_picker_questions','academic_ai_sources','app_notifications','system_audit_logs','system_backups','user_profiles'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_system_trash_registry', table_name);
    execute format('create trigger %I after update of deleted_at on public.%I for each row execute function public.register_system_trash_change()', table_name || '_system_trash_registry', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_system_trash_registry_delete', table_name);
    execute format('create trigger %I after delete on public.%I for each row execute function public.clear_system_trash_registry_row()', table_name || '_system_trash_registry_delete', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_system_trash_expiry', table_name);
    execute format('create trigger %I before update of deleted_at on public.%I for each row execute function public.set_trash_expiry()', table_name || '_system_trash_expiry', table_name);
    execute format('update public.%I set purge_at=deleted_at + make_interval(days => greatest(1,least(coalesce((select (data->>''trash_retention_days'')::integer from public.system_settings where id=true),30),3650))) where deleted_at is not null and purge_at is null', table_name);
    execute format('update public.%I set deleted_at=deleted_at where deleted_at is not null', table_name);
  end loop;
end;
$$;

-- Keep ticket attachment metadata in Trash for exactly the same period as its parent ticket.
create or replace function public.sync_support_ticket_attachment_trash()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.workspace_records
      set deleted_at = coalesce(deleted_at, new.deleted_at),
          purge_at = greatest(coalesce(purge_at, new.purge_at), new.purge_at)
      where module_key = 'source-data-files'
        and (id = new.source_workspace_record_id or external_id = 'support-ticket-file:' || new.id::text)
        and new.purge_at is not null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.workspace_records
      set deleted_at = null
      where module_key = 'source-data-files'
        and (id = new.source_workspace_record_id or external_id = 'support-ticket-file:' || new.id::text)
        and deleted_at = old.deleted_at;
  end if;
  return new;
end;
$$;
drop trigger if exists support_ticket_attachment_trash_sync on public.support_tickets;
create trigger support_ticket_attachment_trash_sync after update of deleted_at on public.support_tickets
  for each row execute function public.sync_support_ticket_attachment_trash();
update public.workspace_records f set deleted_at=t.deleted_at
  from public.support_tickets t
  where t.deleted_at is not null and f.module_key='source-data-files'
    and (f.id=t.source_workspace_record_id or f.external_id='support-ticket-file:' || t.id::text)
    and f.deleted_at is null;
update public.workspace_records f set purge_at=t.purge_at
  from public.support_tickets t
  where t.deleted_at is not null and t.purge_at is not null and f.deleted_at is not null
    and f.module_key='source-data-files'
    and (f.id=t.source_workspace_record_id or f.external_id='support-ticket-file:' || t.id::text)
    and (f.purge_at is null or f.purge_at<t.purge_at);
update public.system_trash_registry r set purge_at=f.purge_at
  from public.workspace_records f
  where r.entity_type='workspace_records' and r.entity_id=f.id::text
    and f.module_key='source-data-files' and f.data ? 'supportTicketId'
    and f.deleted_at is not null and r.purge_at is distinct from f.purge_at;

create or replace function public.list_system_trash()
returns table(entity_type text, entity_id text, module_key text, record_label text, deleted_at timestamptz, purge_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Cần đăng nhập để xem thùng rác'; end if;
  return query select r.entity_type,r.entity_id,r.module_key,r.record_label,r.deleted_at,r.purge_at
    from public.system_trash_registry r
    where r.entity_type not in ('workspace_records','students','support_tickets')
      and (public.is_system_admin() or public.can_access_module(r.module_key,'delete') or public.can_access_module(r.module_key,'restore'))
    order by r.deleted_at desc;
end;
$$;
grant execute on function public.list_system_trash() to authenticated;

create or replace function public.set_system_trash_state(p_entity_type text,p_entity_id text,p_restore boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare module_name text; id_column text := 'id'; action_name text; affected integer; topic_deleted_at timestamptz;
begin
  module_name := case p_entity_type
    when 'random_picker_history' then 'random-picker'
    when 'random_picker_topics' then 'random-picker'
    when 'random_picker_questions' then 'random-picker'
    when 'academic_ai_sources' then 'academic-ai'
    when 'app_notifications' then 'notifications'
    when 'system_audit_logs' then 'audit-logs'
    when 'system_backups' then 'backup'
    when 'user_profiles' then 'accounts'
    else null end;
  if module_name is null then raise exception 'Loại dữ liệu không hỗ trợ trong thùng rác'; end if;
  action_name := case when p_restore then 'restore' else 'delete' end;
  if not public.can_access_module(module_name,action_name) then raise exception 'Không có quyền thao tác mục thùng rác'; end if;
  if p_entity_type='user_profiles' then id_column := 'user_id'; end if;
  if p_entity_type='random_picker_topics' then select deleted_at into topic_deleted_at from public.random_picker_topics where id::text=p_entity_id; end if;
  execute format('update public.%I set deleted_at=%s where %I::text=$1 and deleted_at is %s', p_entity_type,
    case when p_restore then 'null' else 'now()' end,id_column,case when p_restore then 'not null' else 'null' end) using p_entity_id;
  get diagnostics affected = row_count;
  if affected=0 and p_entity_type='random_picker_questions' and p_restore and exists(select 1 from public.random_picker_questions where id::text=p_entity_id and deleted_at is null) then return; end if;
  if affected=0 then raise exception 'Không tìm thấy mục cần thao tác hoặc mục đã đổi trạng thái'; end if;
  if p_entity_type='random_picker_topics' and p_restore then
    update public.random_picker_questions set deleted_at=null where topic_id::text=p_entity_id and deleted_at=topic_deleted_at;
  elsif p_entity_type='random_picker_topics' then
    select deleted_at into topic_deleted_at from public.random_picker_topics where id::text=p_entity_id;
    update public.random_picker_questions set deleted_at=topic_deleted_at where topic_id::text=p_entity_id and deleted_at is null;
    update public.random_picker_topics t set purge_at=greatest(t.purge_at,(select max(q.purge_at) from public.random_picker_questions q where q.topic_id=t.id and q.deleted_at is not null)) where t.id::text=p_entity_id;
    update public.system_trash_registry r set purge_at=t.purge_at from public.random_picker_topics t where r.entity_type='random_picker_topics' and r.entity_id=p_entity_id and t.id::text=r.entity_id;
  end if;
end;
$$;
grant execute on function public.set_system_trash_state(text,text,boolean) to authenticated;

create or replace function public.delete_system_trash_item(p_entity_type text,p_entity_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare module_name text; id_column text := 'id'; affected integer; archived boolean;
begin
  if p_entity_type='random_picker_questions' and not exists(select 1 from public.random_picker_questions where id::text=p_entity_id) then
    if not public.can_access_module('random-picker','delete') or not public.can_access_module('trash','delete') then raise exception 'Trash delete permission required'; end if;
    return;
  end if;
  if p_entity_type in ('user_profiles','academic_ai_sources') then raise exception 'Use the external-service trash cleanup action for this item'; end if;
  module_name := case p_entity_type
    when 'random_picker_history' then 'random-picker' when 'random_picker_topics' then 'random-picker'
    when 'random_picker_questions' then 'random-picker' when 'academic_ai_sources' then 'academic-ai'
    when 'app_notifications' then 'notifications' when 'system_audit_logs' then 'audit-logs'
    when 'system_backups' then 'backup' when 'user_profiles' then 'accounts' else null end;
  if module_name is null or not public.can_access_module(module_name,'delete') then raise exception 'Không có quyền xóa mục này'; end if;
  if p_entity_type='user_profiles' then id_column := 'user_id'; end if;
  if not exists(select 1 from public.system_trash_registry where entity_type=p_entity_type and entity_id=p_entity_id) then raise exception 'Chỉ có thể xóa vĩnh viễn dữ liệu đang ở trong thùng rác'; end if;
  if not public.can_access_module('trash','delete') then raise exception 'Trash delete permission required'; end if;
  execute format('select exists(select 1 from public.%I where %I::text=$1 and deleted_at is not null)',p_entity_type,id_column) into archived using p_entity_id;
  if not archived then raise exception 'Only trashed rows can be permanently deleted'; end if;
  execute format('delete from public.%I where %I::text=$1',p_entity_type,id_column) using p_entity_id;
  get diagnostics affected = row_count;
  if affected=0 then delete from public.system_trash_registry where entity_type=p_entity_type and entity_id=p_entity_id; end if;
end;
$$;
grant execute on function public.delete_system_trash_item(text,text) to authenticated;

create or replace function public.super_admin_delete_notification(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can manage system notifications'; end if;
  update public.app_notifications set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
create or replace function public.super_admin_delete_audit_log(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can manage audit logs'; end if;
  update public.system_audit_logs set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
create or replace function public.super_admin_clear_audit_logs()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can manage audit logs'; end if;
  update public.system_audit_logs set deleted_at=now() where deleted_at is null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
create or replace function public.super_admin_delete_snapshot(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can manage system backups'; end if;
  update public.system_backups set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
grant execute on function public.super_admin_delete_notification(uuid) to authenticated;
grant execute on function public.super_admin_delete_audit_log(bigint) to authenticated;
grant execute on function public.super_admin_clear_audit_logs() to authenticated;
grant execute on function public.super_admin_delete_snapshot(uuid) to authenticated;

create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); admin_call boolean := caller is null or public.is_system_admin(); removed integer := 0; affected integer; item record; key_column text;
begin
  if caller is not null and not admin_call and not public.can_access_module('trash','delete') then raise exception 'Không có quyền quét thùng rác'; end if;
  for item in select entity_type,entity_id from public.system_trash_registry
    where purge_at <= now()
      and entity_type not in ('user_profiles','academic_ai_sources','support_tickets')
      and not (entity_type='workspace_records' and module_key='source-data-files')
      and not (entity_type='workspace_records' and module_key='surveys')
      and (admin_call or (owner_id=caller and public.can_access_module(module_key,'delete'))) loop
    key_column := case when item.entity_type='user_profiles' then 'user_id' else 'id' end;
    execute format('delete from public.%I where %I::text=$1 and deleted_at is not null and purge_at <= now()',item.entity_type,key_column) using item.entity_id;
    get diagnostics affected = row_count;
    if affected > 0 then removed := removed + affected;
    else delete from public.system_trash_registry where entity_type=item.entity_type and entity_id=item.entity_id;
    end if;
  end loop;
  return removed;
end;
$$;
grant execute on function public.purge_expired_trash() to authenticated;

-- Keep removing class history after each class, but archive it in Trash for the
-- configured retention period before the daily trash purge removes it permanently.
create or replace function public.purge_random_picker_history_after_classes()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.random_picker_history h
    set deleted_at = now()
    where h.deleted_at is null
      and h.class_name is not null
      and public.random_picker_session_ended(
        h.class_name,h.drawn_on,h.created_at,now() at time zone 'Asia/Ho_Chi_Minh'
      );
  get diagnostics affected = row_count;
  return affected;
end;
$$;
do $$
begin
  begin
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'select cron.unschedule(jobid) from cron.job where jobname=''vtn-random-picker-history-purge''';
    execute $schedule$
      select cron.schedule('vtn-random-picker-history-purge','* * * * *','select public.purge_random_picker_history_after_classes()')
    $schedule$;
  exception when others then null;
  end;
end;
$$;


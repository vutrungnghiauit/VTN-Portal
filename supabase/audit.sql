-- Run after students.sql, workspace.sql and security.sql.
create table if not exists public.system_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  subject_user_id uuid references auth.users(id) on delete set null,
  module_key text not null,
  action text not null,
  source_table text not null,
  record_id uuid,
  record_label text not null default 'Bản ghi',
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  deleted_at timestamptz,
  purge_at timestamptz,
  event_at timestamptz not null default now()
);
alter table public.system_audit_logs add column if not exists deleted_at timestamptz;
alter table public.system_audit_logs add column if not exists purge_at timestamptz;
create index if not exists system_audit_actor_time_idx on public.system_audit_logs(actor_id,event_at desc);
create index if not exists system_audit_subject_time_idx on public.system_audit_logs(subject_user_id,event_at desc);
create index if not exists system_audit_module_action_idx on public.system_audit_logs(module_key,action,event_at desc);
create index if not exists system_audit_active_time_idx on public.system_audit_logs(event_at desc) where deleted_at is null;
alter table public.system_audit_logs enable row level security;
drop policy if exists "Scoped audit log visibility" on public.system_audit_logs;
create policy "Scoped audit log visibility" on public.system_audit_logs for select to authenticated
using (
  deleted_at is null and (public.is_system_admin()
  or actor_id = (select auth.uid())
  or (public.current_role_key() = 'student' and subject_user_id = (select auth.uid()))
  or (public.current_role_key() = 'teacher' and subject_user_id in (
    select s.auth_user_id from public.students s where s.owner_id = (select auth.uid()) and s.auth_user_id is not null
  )))
);
grant select on public.system_audit_logs to authenticated;
revoke all on public.system_audit_logs from anon, authenticated;
grant select on public.system_audit_logs to authenticated;

create or replace function public.capture_system_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb;
  old_data jsonb;
  actor uuid := (select auth.uid());
  subject uuid;
  rid uuid;
  label text;
  action_name text := lower(tg_op);
  module_name text;
  request_headers jsonb;
  address inet;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op <> 'INSERT' then old_data := to_jsonb(old); end if;
  subject := coalesce(nullif(row_data->>'auth_user_id','')::uuid, nullif(row_data->>'owner_id','')::uuid);
  rid := nullif(row_data->>'id','')::uuid;
  if tg_table_name = 'students' then
    module_name := 'students';
    label := coalesce(row_data->>'full_name',row_data->>'student_code','Sinh viên');
  else
    module_name := coalesce(row_data->>'module_key','workspace');
    label := coalesce(row_data->'data'->>'title',row_data->'data'->>'listName','Bản ghi');
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then action_name := 'move_to_trash'; end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null then action_name := 'restore'; end if;
  begin
    request_headers := nullif(current_setting('request.headers',true),'')::jsonb;
    address := split_part(coalesce(request_headers->>'x-forwarded-for',request_headers->>'x-real-ip',''),',',1)::inet;
  exception when others then address := null;
  end;
  insert into public.system_audit_logs(actor_id,subject_user_id,module_key,action,source_table,record_id,record_label,details,ip_address)
  values(actor,subject,module_name,action_name,tg_table_name,rid,label,
    jsonb_build_object('before',old_data,'after',case when tg_op='DELETE' then null else row_data end),address);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists students_audit_log on public.students;
create trigger students_audit_log after insert or update or delete on public.students for each row execute function public.capture_system_audit();
drop trigger if exists workspace_records_audit_log on public.workspace_records;
create trigger workspace_records_audit_log after insert or update or delete on public.workspace_records for each row execute function public.capture_system_audit();

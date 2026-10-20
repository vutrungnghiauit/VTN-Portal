-- Run after system-settings.sql. Retention is adjustable by the admin in System Settings.
alter table public.students add column if not exists purge_at timestamptz;
alter table public.workspace_records add column if not exists purge_at timestamptz;
update public.students set purge_at = deleted_at + interval '30 days' where deleted_at is not null and purge_at is null;
update public.workspace_records set purge_at = deleted_at + interval '30 days' where deleted_at is not null and purge_at is null;

create or replace function public.set_trash_expiry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare retention_days integer := 30;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    select coalesce((data ->> 'trash_retention_days')::integer,30) into retention_days from public.system_settings where id=true;
    retention_days := greatest(1,least(coalesce(retention_days,30),3650));
    new.purge_at := new.deleted_at + make_interval(days => retention_days);
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.purge_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists students_trash_expiry on public.students;
create trigger students_trash_expiry before update of deleted_at on public.students
  for each row execute function public.set_trash_expiry();
drop trigger if exists workspace_records_trash_expiry on public.workspace_records;
create trigger workspace_records_trash_expiry before update of deleted_at on public.workspace_records
  for each row execute function public.set_trash_expiry();

create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer := 0; removed integer := 0; caller uuid := (select auth.uid()); admin_call boolean := caller is null or public.is_system_admin();
begin
  if caller is not null and not admin_call and not public.can_access_module('trash','delete') then raise exception 'Không có quyền quét thùng rác'; end if;
  if admin_call then
    delete from public.students where deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.workspace_records where deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
  else
    delete from public.students where owner_id = caller and deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.workspace_records where owner_id = caller and deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
  end if;
  return affected;
end;
$$;
grant execute on function public.purge_expired_trash() to authenticated;

-- Schedule daily cleanup where pg_cron is available. If unavailable, the manual scan remains usable.
do $$
begin
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $schedule$
    select cron.schedule('vtn-trash-purge-daily', '17 3 * * *', 'select public.purge_expired_trash()')
  $schedule$;
exception when others then
  raise notice 'pg_cron is unavailable; use the manual expired-trash scan or enable pg_cron.';
end;
$$;

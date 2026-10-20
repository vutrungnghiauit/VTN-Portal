-- Run after audit.sql, notifications.sql, system-settings.sql and trash-retention-all-data.sql.
-- These actions move records to the configured retention trash; hard deletion is reserved for Trash.
create or replace function public.super_admin_delete_notification(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete system notifications'; end if;
  update public.app_notifications set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
create or replace function public.super_admin_delete_audit_log(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete audit logs'; end if;
  update public.system_audit_logs set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
create or replace function public.super_admin_clear_audit_logs()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can clear audit logs'; end if;
  update public.system_audit_logs set deleted_at=now() where deleted_at is null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
create or replace function public.super_admin_delete_snapshot(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete snapshots'; end if;
  update public.system_backups set deleted_at=now() where id=p_id and deleted_at is null;
end;
$$;
grant execute on function public.super_admin_delete_notification(uuid) to authenticated;
grant execute on function public.super_admin_delete_audit_log(bigint) to authenticated;
grant execute on function public.super_admin_clear_audit_logs() to authenticated;
grant execute on function public.super_admin_delete_snapshot(uuid) to authenticated;

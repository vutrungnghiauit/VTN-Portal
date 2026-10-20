-- Run after audit.sql, notifications.sql and system-settings.sql.
-- Protected records have no table-level DELETE grant; only these RPCs may erase them.
create or replace function public.super_admin_delete_notification(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete system notifications'; end if;
  delete from public.app_notifications where id=p_id;
end;
$$;
create or replace function public.super_admin_delete_audit_log(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete audit logs'; end if;
  delete from public.system_audit_logs where id=p_id;
end;
$$;
create or replace function public.super_admin_clear_audit_logs()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can clear audit logs'; end if;
  delete from public.system_audit_logs;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
create or replace function public.super_admin_delete_snapshot(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_key() is distinct from 'super_admin' then raise exception 'Only Super Admin can delete snapshots'; end if;
  delete from public.system_backups where id=p_id;
end;
$$;
grant execute on function public.super_admin_delete_notification(uuid) to authenticated;
grant execute on function public.super_admin_delete_audit_log(bigint) to authenticated;
grant execute on function public.super_admin_clear_audit_logs() to authenticated;
grant execute on function public.super_admin_delete_snapshot(uuid) to authenticated;

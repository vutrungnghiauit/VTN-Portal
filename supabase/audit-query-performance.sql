-- Apply in Supabase SQL Editor to speed up the system audit page.
create index if not exists system_audit_active_time_idx
  on public.system_audit_logs(event_at desc)
  where deleted_at is null;

create index if not exists system_trash_registry_entity_deleted_idx
  on public.system_trash_registry(entity_type, deleted_at desc);

create or replace function public.list_system_trash_by_type(p_entity_type text)
returns table(entity_type text, entity_id text, module_key text, record_label text, deleted_at timestamptz, purge_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Cần đăng nhập để xem thùng rác'; end if;
  return query select r.entity_type,r.entity_id,r.module_key,r.record_label,r.deleted_at,r.purge_at
    from public.system_trash_registry r
    where r.entity_type = p_entity_type
      and r.entity_type not in ('workspace_records','students','support_tickets')
      and (public.is_system_admin() or public.can_access_module(r.module_key,'delete') or public.can_access_module(r.module_key,'restore'))
    order by r.deleted_at desc;
end;
$$;
grant execute on function public.list_system_trash_by_type(text) to authenticated;

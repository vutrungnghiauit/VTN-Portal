-- Run after support-tickets.sql, security.sql, audit.sql and trash-retention.sql.
alter table public.support_tickets add column if not exists deleted_at timestamptz;
alter table public.support_tickets add column if not exists purge_at timestamptz;
create index if not exists support_tickets_trash_idx on public.support_tickets(purge_at) where deleted_at is not null;

drop policy if exists "Ticket parties and admins can read" on public.support_tickets;
drop policy if exists "Ticket parties and authorized staff can read" on public.support_tickets;
create policy "Ticket parties and authorized staff can read" on public.support_tickets for select to authenticated
using (
  student_user_id = (select auth.uid()) or teacher_id = (select auth.uid()) or public.is_system_admin()
  or (public.current_role_key() = 'assistant' and public.can_access_module('supports','read'))
);
drop policy if exists "Teacher updates assigned ticket status" on public.support_tickets;
drop policy if exists "Ticket parties and staff can update" on public.support_tickets;
create policy "Ticket parties and staff can update" on public.support_tickets for update to authenticated
using (
  ((teacher_id = (select auth.uid()) or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or (student_user_id = (select auth.uid()) and status = 'pending' and public.can_access_module('supports','update'))
)
with check (
  ((teacher_id = (select auth.uid()) or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or (student_user_id = (select auth.uid()) and status = 'pending' and public.can_access_module('supports','update'))
);
grant update on public.support_tickets to authenticated;
drop policy if exists "Staff permanently delete trashed tickets" on public.support_tickets;
create policy "Staff permanently delete trashed tickets" on public.support_tickets for delete to authenticated
using (deleted_at is not null and public.can_access_module('supports','delete') and (teacher_id = (select auth.uid()) or public.is_system_admin() or public.current_role_key() = 'assistant'));
grant delete on public.support_tickets to authenticated;

create or replace function public.protect_support_ticket_edits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.student_user_id is distinct from old.student_user_id or new.teacher_id is distinct from old.teacher_id then
    raise exception 'Không thể đổi người gửi hoặc giảng viên phụ trách phiếu';
  end if;
  if public.current_role_key() = 'student' then
    if old.student_user_id <> (select auth.uid()) or old.status <> 'pending' or new.status <> old.status then
      raise exception 'Sinh viên chỉ được sửa phiếu đang chờ xử lý của mình';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists support_ticket_edit_protection on public.support_tickets;
create trigger support_ticket_edit_protection before update on public.support_tickets
for each row execute function public.protect_support_ticket_edits();

drop trigger if exists support_ticket_trash_expiry on public.support_tickets;
create trigger support_ticket_trash_expiry before update of deleted_at on public.support_tickets
for each row execute function public.set_trash_expiry();

create or replace function public.capture_support_ticket_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); action_name text := lower(tg_op); address inet; row_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then action_name := 'move_to_trash'; end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null then action_name := 'restore'; end if;
  begin address := split_part(coalesce((nullif(current_setting('request.headers',true),'')::jsonb)->>'x-forwarded-for',''),',',1)::inet; exception when others then address := null; end;
  insert into public.system_audit_logs(actor_id,subject_user_id,module_key,action,source_table,record_id,record_label,details,ip_address)
  values(actor,coalesce(new.student_user_id,old.student_user_id),'supports',action_name,'support_tickets',coalesce(new.id,old.id),coalesce(new.title,old.title),
    jsonb_build_object('before',case when tg_op='INSERT' then null else to_jsonb(old) end,'after',case when tg_op='DELETE' then null else row_data end),address);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists support_tickets_audit_log on public.support_tickets;
create trigger support_tickets_audit_log after insert or update or delete on public.support_tickets
for each row execute function public.capture_support_ticket_audit();

create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer := 0; removed integer := 0; caller uuid := (select auth.uid()); admin_call boolean := caller is null or public.is_system_admin();
begin
  if caller is not null and not admin_call and not public.can_access_module('trash','delete') then raise exception 'Không có quyền quét thùng rác'; end if;
  if admin_call then
    delete from public.students where deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.workspace_records where deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.support_tickets where deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
  else
    delete from public.students where owner_id = caller and deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.workspace_records where owner_id = caller and deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
    delete from public.support_tickets where (teacher_id = caller or student_user_id = caller) and deleted_at is not null and purge_at <= now(); get diagnostics removed = row_count; affected := affected + removed;
  end if;
  return affected;
end;
$$;
grant execute on function public.purge_expired_trash() to authenticated;

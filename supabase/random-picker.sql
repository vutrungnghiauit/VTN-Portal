-- Run after security.sql and audit.sql.
create table if not exists public.random_picker_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draw_type text not null check (draw_type in ('roll_call','groups','presentation_order','oral_question','study_pairs')),
  student_id uuid references public.students(id) on delete set null,
  student_code text,
  student_name text,
  class_name text,
  attendance_status text check (attendance_status in ('present','absent')),
  drawn_on date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists random_picker_history_owner_time_idx on public.random_picker_history(owner_id,created_at desc);
create unique index if not exists random_picker_one_call_per_student_daily_idx
  on public.random_picker_history(owner_id,student_id,drawn_on) where draw_type = 'roll_call' and student_id is not null;
alter table public.random_picker_history enable row level security;
drop policy if exists "Users read own random history" on public.random_picker_history;
create policy "Users read own random history" on public.random_picker_history for select to authenticated
  using (owner_id = (select auth.uid()) and public.can_access_module('random-picker','read'));
drop policy if exists "Users create own random history" on public.random_picker_history;
create policy "Users create own random history" on public.random_picker_history for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_access_module('random-picker','create'));
drop policy if exists "Users update own attendance result" on public.random_picker_history;
create policy "Users update own attendance result" on public.random_picker_history for update to authenticated
  using (owner_id = (select auth.uid()) and public.can_access_module('random-picker','update'))
  with check (owner_id = (select auth.uid()) and public.can_access_module('random-picker','update'));
grant select,insert,update on public.random_picker_history to authenticated;
revoke all on public.random_picker_history from anon;

create or replace function public.protect_random_picker_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then raise exception 'Không thể ghi lịch sử cho tài khoản khác'; end if;
  else
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.draw_type is distinct from old.draw_type
      or new.student_id is distinct from old.student_id or new.student_code is distinct from old.student_code
      or new.student_name is distinct from old.student_name or new.class_name is distinct from old.class_name
      or new.results is distinct from old.results or new.drawn_on is distinct from old.drawn_on
      or new.created_at is distinct from old.created_at then raise exception 'Chỉ được cập nhật trạng thái điểm danh'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists random_picker_history_protection on public.random_picker_history;
create trigger random_picker_history_protection before insert or update on public.random_picker_history
  for each row execute function public.protect_random_picker_history();

create or replace function public.audit_random_picker_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; action_name text;
begin
  row_data := to_jsonb(new);
  action_name := case when tg_op = 'INSERT' then 'draw' else 'attendance' end;
  insert into public.system_audit_logs(actor_id,subject_user_id,module_key,action,source_table,record_id,record_label,details)
  values ((select auth.uid()),new.owner_id,'random-picker',action_name,'random_picker_history',new.id,
    coalesce(new.student_name,new.draw_type),jsonb_build_object('before',case when tg_op='INSERT' then null else to_jsonb(old) end,'after',row_data));
  return new;
end;
$$;
drop trigger if exists random_picker_history_audit on public.random_picker_history;
create trigger random_picker_history_audit after insert or update on public.random_picker_history
  for each row execute function public.audit_random_picker_history();

-- The student role can use the picker and mark its own call records only.
update public.role_module_permissions set allowed = true,updated_at = now()
  where role_key in ('student','class_president','class_vice') and module_key = 'random-picker' and action_key in ('read','create','update');

-- Run after students.sql and security.sql. Students can submit tickets to their record's teacher.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null check (length(trim(description)) > 0),
  category text not null default 'Học vụ',
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (student_user_id <> teacher_id)
);
create index if not exists support_tickets_teacher_created_idx on public.support_tickets(teacher_id,created_at desc);
create index if not exists support_tickets_student_created_idx on public.support_tickets(student_user_id,created_at desc);
alter table public.support_tickets enable row level security;
drop policy if exists "Ticket parties and admins can read" on public.support_tickets;
create policy "Ticket parties and admins can read" on public.support_tickets for select to authenticated
using (student_user_id=(select auth.uid()) or teacher_id=(select auth.uid()) or public.is_system_admin());
drop policy if exists "Students submit ticket to assigned teacher" on public.support_tickets;
create policy "Students submit ticket to assigned teacher" on public.support_tickets for insert to authenticated
with check (
  student_user_id=(select auth.uid())
  and exists(select 1 from public.students s where s.auth_user_id=(select auth.uid()) and s.owner_id=teacher_id and s.deleted_at is null)
);
drop policy if exists "Teacher updates assigned ticket status" on public.support_tickets;
create policy "Teacher updates assigned ticket status" on public.support_tickets for update to authenticated
using (teacher_id=(select auth.uid()) or public.is_system_admin())
with check (teacher_id=(select auth.uid()) or public.is_system_admin());
grant select,insert,update on public.support_tickets to authenticated;
revoke delete on public.support_tickets from authenticated,anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_tickets') then
    alter publication supabase_realtime add table public.support_tickets;
  end if;
exception when undefined_object then
  raise notice 'Enable support_tickets in Supabase Database publications to receive realtime updates.';
end;
$$;

-- Run in Supabase SQL Editor. Each authenticated teacher owns a private set of student records.
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_code text not null check (length(trim(student_code)) > 0),
  full_name text not null check (length(trim(full_name)) > 0),
  date_of_birth date,
  class_name text,
  faculty text,
  semester_name text,
  email text,
  phone text,
  notes text,
  auth_user_id uuid references auth.users(id) on delete set null,
  academic_status text not null default 'Đang học',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_at timestamptz
);

alter table public.students add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.students add column if not exists faculty text;
alter table public.students add column if not exists semester_name text;
alter table public.students add column if not exists academic_status text not null default 'Đang học';
alter table public.students add column if not exists purge_at timestamptz;

-- Codes are unique per teacher, case-insensitively; trashed records still reserve their code.
create unique index if not exists students_owner_student_code_unique
  on public.students (owner_id, lower(student_code));
create index if not exists students_owner_created_at_idx
  on public.students (owner_id, created_at desc)
  where deleted_at is null;

alter table public.students enable row level security;

drop policy if exists "Teachers can read their own students" on public.students;
create policy "Teachers can read their own students"
  on public.students for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Teachers can add their own students" on public.students;
create policy "Teachers can add their own students"
  on public.students for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Teachers can update their own students" on public.students;
create policy "Teachers can update their own students"
  on public.students for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update on public.students to authenticated;
drop policy if exists "Teachers can permanently delete their trashed students" on public.students;
create policy "Teachers can permanently delete their trashed students"
  on public.students for delete to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is not null);
grant delete on public.students to authenticated;
revoke all on public.students from anon;

-- Apply after students.sql. Adds fields used by semester-scoped overview charts.
alter table public.students add column if not exists faculty text;
alter table public.students add column if not exists semester_name text;
alter table public.students add column if not exists academic_status text not null default 'Đang học';

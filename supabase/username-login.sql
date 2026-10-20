-- Optional one-time linkage for existing student accounts.
-- A student record is linked only when the email maps to one MSSV and that
-- Auth user is not already linked to a different student.
drop index if exists public.students_auth_user_unique;
create index if not exists students_auth_user_idx on public.students (auth_user_id) where auth_user_id is not null;
create or replace function public.protect_student_auth_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres','supabase_admin','service_role') then
    if tg_op = 'INSERT' and new.auth_user_id is not null then
      raise exception 'Liên kết tài khoản sinh viên chỉ được quản lý bởi quản trị viên';
    elsif tg_op = 'UPDATE' and new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'Liên kết tài khoản sinh viên chỉ được quản lý bởi quản trị viên';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists students_auth_link_protection on public.students;
create trigger students_auth_link_protection before insert or update on public.students
  for each row execute function public.protect_student_auth_link();

create table if not exists public.account_login_attempts (
  login_key text primary key check (length(login_key) = 64),
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_login_attempts enable row level security;
revoke all on public.account_login_attempts from public, anon, authenticated;
create or replace function public.check_account_login_rate(p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_attempts integer;
begin
  if length(p_key) <> 64 then return false; end if;
  insert into public.account_login_attempts(login_key,attempt_count,window_started_at,updated_at)
  values(p_key,1,now(),now())
  on conflict(login_key) do update set
    attempt_count = case when public.account_login_attempts.window_started_at < now() - interval '15 minutes' then 1 else public.account_login_attempts.attempt_count + 1 end,
    window_started_at = case when public.account_login_attempts.window_started_at < now() - interval '15 minutes' then now() else public.account_login_attempts.window_started_at end,
    updated_at = now()
  returning attempt_count into current_attempts;
  delete from public.account_login_attempts where updated_at < now() - interval '1 day';
  return current_attempts <= 8;
end;
$$;
revoke all on function public.check_account_login_rate(text) from public, anon, authenticated;
grant execute on function public.check_account_login_rate(text) to service_role;
create or replace function public.clear_account_login_rate(p_key text)
returns void language sql security definer set search_path = '' as $$
  delete from public.account_login_attempts where login_key = p_key;
$$;
revoke all on function public.clear_account_login_rate(text) from public, anon, authenticated;
grant execute on function public.clear_account_login_rate(text) to service_role;

with unique_student_emails as (
  select lower(trim(email)) as email_key
  from public.students
  where email is not null and trim(email) <> '' and deleted_at is null
  group by lower(trim(email))
  having count(distinct lower(trim(student_code))) = 1
), matches as (
  select s.id as student_id, u.id as user_id
  from public.students s
  join unique_student_emails e on e.email_key = lower(trim(s.email))
  join auth.users u on lower(u.email) = e.email_key
  join public.user_profiles p on p.user_id = u.id and p.role_key = 'student'
  where s.deleted_at is null and s.auth_user_id is null
    and not exists (select 1 from public.students owned where owned.auth_user_id = u.id and lower(trim(owned.student_code)) <> lower(trim(s.student_code)))
)
update public.students s set auth_user_id = m.user_id
from matches m where s.id = m.student_id;

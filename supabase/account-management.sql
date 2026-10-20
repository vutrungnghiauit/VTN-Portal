-- Run after security.sql and account-registration.sql.
-- Assigns directly managed staff/student accounts to their supervising teacher.
alter table public.user_profiles
  add column if not exists manager_id uuid references public.user_profiles(user_id) on delete set null;

create index if not exists user_profiles_manager_id_idx
  on public.user_profiles(manager_id) where manager_id is not null;

create or replace function public.protect_profile_management_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres','supabase_admin','service_role') then
    if new.role_key is distinct from old.role_key or new.manager_id is distinct from old.manager_id then
      raise exception 'Vai trò và người quản lý chỉ được thay đổi qua chức năng quản trị an toàn';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_management_fields_protection on public.user_profiles;
create trigger user_profiles_management_fields_protection
  before update on public.user_profiles
  for each row execute function public.protect_profile_management_fields();

-- Teachers manage accounts for students they own and accounts assigned to them.
insert into public.role_module_permissions(role_key,module_key,action_key,allowed)
values ('teacher','accounts','read',true),('teacher','accounts','create',true),
       ('teacher','accounts','update',true),('teacher','accounts','delete',true)
on conflict (role_key,module_key,action_key)
do update set allowed = excluded.allowed, updated_at = now();

revoke all on function public.protect_profile_management_fields() from public, anon, authenticated;

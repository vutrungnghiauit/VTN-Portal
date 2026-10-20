-- Run after security.sql. The public RPC exposes only signup policy; all account
-- administration continues to require an authenticated administrator.
alter table public.user_profiles
  add column if not exists registration_status text not null default 'approved'
  check (registration_status in ('pending','approved','rejected'));

create table if not exists public.account_registration_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  approval_required boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.account_registration_settings (id) values (true) on conflict (id) do nothing;
alter table public.account_registration_settings enable row level security;
revoke all on public.account_registration_settings from anon, authenticated;

create or replace function public.get_registration_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', enabled, 'approvalRequired', approval_required)
  from public.account_registration_settings where id = true;
$$;
revoke all on function public.get_registration_settings() from public;
grant execute on function public.get_registration_settings() to anon, authenticated;

create or replace function public.save_registration_settings(p_enabled boolean, p_approval_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_system_admin() then raise exception 'Chỉ quản trị viên mới được cấu hình đăng ký tài khoản'; end if;
  insert into public.account_registration_settings(id,enabled,approval_required,updated_by,updated_at)
  values(true,p_enabled,p_approval_required,(select auth.uid()),now())
  on conflict(id) do update set enabled=excluded.enabled, approval_required=excluded.approval_required,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.save_registration_settings(boolean,boolean) from public, anon;
grant execute on function public.save_registration_settings(boolean,boolean) to authenticated;

create or replace function public.protect_profile_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role_key is distinct from old.role_key and current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'Vai trò chỉ được thay đổi qua chức năng quản trị an toàn';
  end if;
  return new;
end;
$$;

create or replace function public.protect_registration_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.registration_status is distinct from old.registration_status and current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'Trạng thái duyệt chỉ được thay đổi bởi quản trị viên';
  end if;
  return new;
end;
$$;
drop trigger if exists user_profiles_registration_status_protection on public.user_profiles;
create trigger user_profiles_registration_status_protection before update on public.user_profiles
  for each row execute function public.protect_registration_status();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pending boolean := false;
begin
  select coalesce(approval_required, false) into pending
  from public.account_registration_settings where id = true;
  insert into public.user_profiles (user_id, username, role_key, display_name, registration_status)
  values (new.id, split_part(coalesce(new.email,new.phone,'user'),'@',1) || '_' || left(new.id::text,6), 'student', coalesce(new.raw_user_meta_data->>'full_name',''), case when pending then 'pending' else 'approved' end)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.get_my_access_matrix()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); caller_role text; status text; permission_json jsonb;
begin
  select role_key, registration_status into caller_role, status from public.user_profiles where user_id = caller;
  if caller_role is null then raise exception 'Chưa gán vai trò cho tài khoản'; end if;
  if caller_role = 'super_admin' then return jsonb_build_object('role',caller_role,'superAdmin',true,'permissions','{}'::jsonb,'registrationStatus',status); end if;
  if status <> 'approved' then return jsonb_build_object('role',caller_role,'superAdmin',false,'permissions','{}'::jsonb,'registrationStatus',status); end if;
  select coalesce(jsonb_object_agg(module_key, actions), '{}'::jsonb) into permission_json
  from (select module_key,jsonb_object_agg(action_key,allowed) actions from (
    select distinct on (module_key,action_key) module_key,action_key,allowed from (
      select module_key,action_key,allowed,0 priority from public.role_module_permissions where role_key=caller_role
      union all select module_key,action_key,allowed,1 priority from public.user_module_permissions where user_id=caller
    ) combined order by module_key,action_key,priority desc
  ) effective group by module_key) grouped;
  return jsonb_build_object('role',caller_role,'superAdmin',false,'permissions',permission_json,'registrationStatus',status);
end;
$$;
grant execute on function public.get_my_access_matrix() to authenticated;

create or replace function public.can_access_module(p_module text, p_action text default 'read')
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); caller_role text; status text; override_value boolean; role_value boolean;
begin
  select role_key,registration_status into caller_role,status from public.user_profiles where user_id=caller;
  if caller_role is null then return false; end if;
  if caller_role='super_admin' then return true; end if;
  if status <> 'approved' then return false; end if;
  select allowed into override_value from public.user_module_permissions where user_id=caller and module_key=p_module and action_key=p_action;
  if found then return override_value; end if;
  select allowed into role_value from public.role_module_permissions where role_key=caller_role and module_key=p_module and action_key=p_action;
  return coalesce(role_value,false);
end;
$$;
grant execute on function public.can_access_module(text,text) to authenticated;

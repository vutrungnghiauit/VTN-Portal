-- Run after students.sql and workspace.sql. Auth users start as students; a project owner
-- assigns trusted roles after verifying each account's identity.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  role_key text not null default 'student' check (role_key in ('super_admin','system_admin','sub_admin','teacher','assistant','class_president','class_vice','student')),
  display_name text not null default '',
  lecturer_code text,
  degree text,
  job_title text,
  department text,
  phone text,
  office text,
  avatar_url text,
  deleted_at timestamptz,
  purge_at timestamptz,
  trash_previous_banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles add column if not exists deleted_at timestamptz;
alter table public.user_profiles add column if not exists purge_at timestamptz;
alter table public.user_profiles add column if not exists trash_previous_banned_until timestamptz;

alter table public.students add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.students add column if not exists academic_status text not null default 'Đang học';
create unique index if not exists students_auth_user_unique on public.students (auth_user_id) where auth_user_id is not null;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  proposed_username text;
begin
  proposed_username := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(coalesce(new.email, new.phone, 'user'), '@', 1) || '_' || left(new.id::text, 6));
  insert into public.user_profiles (user_id, username, display_name, role_key)
  values (new.id, proposed_username, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'student')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.user_profiles (user_id, username, display_name, role_key)
select id, split_part(coalesce(email, phone, 'user'), '@', 1) || '_' || left(id::text, 6), coalesce(raw_user_meta_data ->> 'full_name', ''), 'student'
from auth.users on conflict (user_id) do nothing;

create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = '' as $$
  select role_key from public.user_profiles where user_id = (select auth.uid()) and deleted_at is null
$$;

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_key() in ('super_admin','system_admin','sub_admin'), false)
$$;

create or replace function public.can_access_module(p_module text, p_action text default 'read')
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  override_value boolean;
  role_value boolean;
begin
  if caller is null then return false; end if;
  select role_key into caller_role from public.user_profiles where user_id = caller and deleted_at is null;
  if not found then return false; end if;
  if caller_role = 'super_admin' then return true; end if;
  select allowed into override_value from public.user_module_permissions
    where user_id = caller and module_key = p_module and action_key = p_action;
  if found then return override_value; end if;
  select allowed into role_value from public.role_module_permissions
    where role_key = caller_role and module_key = p_module and action_key = p_action;
  return coalesce(role_value, false);
end;
$$;

create table if not exists public.role_module_permissions (
  role_key text not null check (role_key in ('system_admin','sub_admin','teacher','assistant','class_president','class_vice','student')),
  module_key text not null,
  action_key text not null check (action_key in ('read','create','update','delete','restore','export')),
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role_key, module_key, action_key)
);
create table if not exists public.user_module_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null,
  action_key text not null check (action_key in ('read','create','update','delete','restore','export')),
  allowed boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key, action_key)
);

insert into public.role_module_permissions (role_key, module_key, action_key, allowed)
select r.role_key, m.module_key, a.action_key,
  case
    when r.role_key in ('system_admin','sub_admin') then true
    when r.role_key = 'teacher' then a.action_key in ('read','create','update','delete','restore','export') and m.module_key not in ('accounts','permissions','settings')
    when r.role_key = 'assistant' then (a.action_key in ('read','create','update') or (a.action_key = 'delete' and m.module_key = 'random-picker')) and m.module_key in ('dashboard','students','student-records','semesters','academic-years','grades','assignments','tasks','groups','teaching-plans','calendar','documents','academic-ai','source-data','student-support','supports','surveys','forms-templates','notifications','random-picker','my-profile','trash')
    when r.role_key in ('class_president','class_vice') then (a.action_key in ('read','create') or (a.action_key = 'update' and m.module_key = 'random-picker')) and m.module_key in ('dashboard','student-records','assignments','tasks','groups','calendar','documents','supports','surveys','notifications','my-profile','random-picker')
    when r.role_key = 'student' then (a.action_key = 'read' or (a.action_key = 'create' and m.module_key = 'groups') or (a.action_key in ('create','update') and m.module_key = 'random-picker')) and m.module_key in ('dashboard','student-records','assignments','documents','academic-ai','supports','surveys','notifications','forms-templates','my-profile','random-picker','groups')
    else false
  end
from (values ('system_admin'),('sub_admin'),('teacher'),('assistant'),('class_president'),('class_vice'),('student')) as r(role_key)
cross join (values ('dashboard'),('academic-years'),('semesters'),('timetables'),('students'),('student-records'),('groups'),('teaching-plans'),('calendar'),('grades'),('assignments'),('tasks'),('student-support'),('academic-ai'),('documents'),('source-data'),('forms-templates'),('surveys'),('notifications'),('announcements'),('supports'),('random-picker'),('my-profile'),('accounts'),('permissions'),('audit-logs'),('backup'),('trash'),('settings')) as m(module_key)
cross join (values ('read'),('create'),('update'),('delete'),('restore'),('export')) as a(action_key)
on conflict (role_key, module_key, action_key) do nothing;

insert into public.role_module_permissions (role_key, module_key, action_key, allowed)
values ('assistant','random-picker','delete',true)
on conflict (role_key,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();

alter table public.user_profiles enable row level security;
drop policy if exists "Users read own profiles and admins read all" on public.user_profiles;
create policy "Users read own profiles and admins read all" on public.user_profiles for select to authenticated
  using (deleted_at is null and (user_id = (select auth.uid()) or public.is_system_admin()));
drop policy if exists "Users update their own profile fields" on public.user_profiles;
create policy "Users update their own profile fields" on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.is_system_admin())
  with check (user_id = (select auth.uid()) or public.is_system_admin());
create or replace function public.protect_profile_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role_key is distinct from old.role_key and current_user not in ('postgres','supabase_admin') then
    raise exception 'Vai trò chỉ được thay đổi qua chức năng quản trị an toàn';
  end if;
  return new;
end;
$$;
drop trigger if exists user_profiles_role_protection on public.user_profiles;
create trigger user_profiles_role_protection before update on public.user_profiles
  for each row execute function public.protect_profile_role();

alter table public.role_module_permissions enable row level security;
drop policy if exists "Admins read role permissions" on public.role_module_permissions;
create policy "Admins read role permissions" on public.role_module_permissions for select to authenticated using (public.is_system_admin());
alter table public.user_module_permissions enable row level security;
drop policy if exists "Admins read user permission overrides" on public.user_module_permissions;
create policy "Admins read user permission overrides" on public.user_module_permissions for select to authenticated using (public.is_system_admin());
grant select on public.user_profiles, public.role_module_permissions, public.user_module_permissions to authenticated;
revoke insert, delete on public.user_profiles, public.role_module_permissions, public.user_module_permissions from authenticated;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); target_role text;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Không có quyền quản lý vai trò'; end if;
  if p_role not in ('super_admin','system_admin','sub_admin','teacher','assistant','class_president','class_vice','student') then raise exception 'Vai trò không hợp lệ'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id for update;
  if target_role is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if target_role = 'super_admin' then raise exception 'Vai trò Super Admin được khóa cố định'; end if;
  if p_role = 'super_admin' then raise exception 'Không thể cấp Super Admin từ giao diện'; end if;
  if caller_role <> 'super_admin' and p_role in ('system_admin','sub_admin') then raise exception 'Chỉ Super Admin mới được cấp vai trò quản trị'; end if;
  update public.user_profiles set role_key = p_role, updated_at = now() where user_id = p_user_id;
end;
$$;
grant execute on function public.set_user_role(uuid, text) to authenticated;

create or replace function public.set_role_module_permission(p_role text, p_module text, p_action text, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key();
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Không có quyền cấu hình RBAC'; end if;
  if p_role = 'super_admin' then raise exception 'Quyền Super Admin luôn bật và không thể chỉnh sửa'; end if;
  insert into public.role_module_permissions (role_key,module_key,action_key,allowed,updated_at)
  values (p_role,p_module,p_action,p_allowed,now())
  on conflict (role_key,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();
end;
$$;
grant execute on function public.set_role_module_permission(text,text,text,boolean) to authenticated;

create or replace function public.set_user_module_permission(p_user_id uuid, p_module text, p_action text, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); target_role text;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Không có quyền cấu hình RBAC'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if target_role = 'super_admin' and not (caller_role = 'super_admin' and p_user_id = (select auth.uid())) then raise exception 'Quyền Super Admin luôn bật và không thể chỉnh sửa'; end if;
  insert into public.user_module_permissions (user_id,module_key,action_key,allowed,updated_at)
  values (p_user_id,p_module,p_action,p_allowed,now())
  on conflict (user_id,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();
end;
$$;
grant execute on function public.set_user_module_permission(uuid,text,text,boolean) to authenticated;

create or replace function public.get_my_access_matrix()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  permission_json jsonb;
begin
  select role_key into caller_role from public.user_profiles where user_id = caller;
  if caller_role is null then raise exception 'Chưa gán vai trò cho tài khoản'; end if;
  if caller_role = 'super_admin' then return jsonb_build_object('role',caller_role,'superAdmin',true,'permissions','{}'::jsonb); end if;
  select coalesce(jsonb_object_agg(module_key, actions), '{}'::jsonb) into permission_json
  from (
    select module_key, jsonb_object_agg(action_key, allowed) as actions
    from (
      select distinct on (module_key, action_key) module_key, action_key, allowed
      from (
        select module_key, action_key, allowed, 0 as priority from public.role_module_permissions where role_key = caller_role
        union all
        select module_key, action_key, allowed, 1 as priority from public.user_module_permissions where user_id = caller
      ) as combined order by module_key, action_key, priority desc
    ) as effective group by module_key
  ) as grouped;
  return jsonb_build_object('role',caller_role,'superAdmin',false,'permissions',permission_json);
end;
$$;
grant execute on function public.get_my_access_matrix() to authenticated;

create or replace function public.get_user_access_matrix(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller_role text := public.current_role_key();
  target_role text;
  permission_json jsonb;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Không có quyền xem ma trận người dùng'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if target_role = 'super_admin' and p_user_id <> (select auth.uid()) then return jsonb_build_object('role',target_role,'superAdmin',true,'permissions','{}'::jsonb); end if;
  select coalesce(jsonb_object_agg(module_key, actions), '{}'::jsonb) into permission_json from (
    select module_key,jsonb_object_agg(action_key,allowed) as actions from (
      select distinct on (module_key,action_key) module_key,action_key,allowed from (
        select module_key,action_key,allowed,0 as priority from public.role_module_permissions where role_key=target_role
        union all
        select module_key,action_key,allowed,1 as priority from public.user_module_permissions where user_id=p_user_id
      ) as candidates order by module_key,action_key,priority desc
    ) as effective group by module_key
  ) as grouped;
  return jsonb_build_object('role',target_role,'superAdmin',false,'permissions',permission_json);
end;
$$;
grant execute on function public.get_user_access_matrix(uuid) to authenticated;

create or replace function public.reset_role_permissions()
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key();
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Không có quyền khôi phục RBAC'; end if;
  delete from public.role_module_permissions where role_key <> 'super_admin';
  insert into public.role_module_permissions (role_key,module_key,action_key,allowed)
  select r.role_key,m.module_key,a.action_key,
    case when r.role_key in ('system_admin','sub_admin') then true
      when r.role_key = 'teacher' then a.action_key in ('read','create','update','delete','restore','export') and m.module_key not in ('accounts','permissions','settings')
      when r.role_key = 'assistant' then (a.action_key in ('read','create','update') or (a.action_key = 'delete' and m.module_key = 'random-picker')) and m.module_key not in ('accounts','permissions','settings','audit-logs','backup')
      when r.role_key in ('class_president','class_vice') then (a.action_key in ('read','create') or (a.action_key = 'update' and m.module_key = 'random-picker')) and m.module_key in ('dashboard','student-records','assignments','tasks','groups','calendar','documents','supports','surveys','notifications','my-profile','random-picker')
      when r.role_key = 'student' then (a.action_key = 'read' or (a.action_key = 'create' and m.module_key = 'groups') or (a.action_key in ('create','update') and m.module_key = 'random-picker')) and m.module_key in ('dashboard','student-records','assignments','documents','academic-ai','supports','surveys','notifications','forms-templates','my-profile','random-picker','groups') else false end
  from (values ('system_admin'),('sub_admin'),('teacher'),('assistant'),('class_president'),('class_vice'),('student')) as r(role_key)
  cross join (values ('dashboard'),('academic-years'),('semesters'),('timetables'),('students'),('student-records'),('groups'),('teaching-plans'),('calendar'),('grades'),('assignments'),('tasks'),('student-support'),('academic-ai'),('documents'),('source-data'),('forms-templates'),('surveys'),('notifications'),('announcements'),('supports'),('random-picker'),('my-profile'),('accounts'),('permissions'),('audit-logs'),('backup'),('trash'),('settings')) as m(module_key)
  cross join (values ('read'),('create'),('update'),('delete'),('restore'),('export')) as a(action_key);
  delete from public.user_module_permissions;
end;
$$;
grant execute on function public.reset_role_permissions() to authenticated;

drop policy if exists "Teachers read owned students and students read their own record" on public.students;
create policy "Teachers read owned students and students read their own record" on public.students for select to authenticated
  using (((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module('students','read'))
    or (auth_user_id = (select auth.uid()) and public.can_access_module('student-records','read')));
drop policy if exists "Teachers update their own students" on public.students;
create policy "Teachers update their own students" on public.students for update to authenticated
  using ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module('students','update'))
  with check ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module('students','update'));
drop policy if exists "Teachers add their own students" on public.students;
create policy "Teachers add their own students" on public.students for insert to authenticated
  with check ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module('students','create'));
drop policy if exists "Teachers can permanently delete their trashed students" on public.students;
create policy "Teachers can permanently delete their trashed students" on public.students for delete to authenticated
  using ((owner_id = (select auth.uid()) or public.is_system_admin()) and deleted_at is not null and public.can_access_module('students','delete'));

drop policy if exists "Teachers can read their own workspace records" on public.workspace_records;
create policy "Teachers can read their own workspace records" on public.workspace_records for select to authenticated
  using ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module(module_key,'read'));
drop policy if exists "Teachers can add their own workspace records" on public.workspace_records;
create policy "Teachers can add their own workspace records" on public.workspace_records for insert to authenticated
  with check ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module(module_key,'create'));
drop policy if exists "Teachers can update their own workspace records" on public.workspace_records;
create policy "Teachers can update their own workspace records" on public.workspace_records for update to authenticated
  using ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module(module_key,'update'))
  with check ((owner_id = (select auth.uid()) or public.is_system_admin()) and public.can_access_module(module_key,'update'));
drop policy if exists "Teachers can delete their own trashed workspace records" on public.workspace_records;
create policy "Teachers can delete their own trashed workspace records" on public.workspace_records for delete to authenticated
  using ((owner_id = (select auth.uid()) or public.is_system_admin()) and deleted_at is not null and public.can_access_module(module_key,'delete'));

create or replace function public.set_workspace_trash_state(p_id uuid, p_restore boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.workspace_records%rowtype; caller uuid := (select auth.uid());
begin
  select * into target from public.workspace_records where id=p_id;
  if not found then raise exception 'Không tìm thấy bản ghi'; end if;
  if target.owner_id <> caller and not public.is_system_admin() then raise exception 'Không có quyền với bản ghi này'; end if;
  if p_restore then
    if not public.can_access_module(target.module_key,'restore') then raise exception 'Không có quyền khôi phục'; end if;
    update public.workspace_records set deleted_at=null where id=p_id;
  else
    if not public.can_access_module(target.module_key,'delete') then raise exception 'Không có quyền chuyển vào thùng rác'; end if;
    update public.workspace_records set deleted_at=now() where id=p_id and deleted_at is null;
  end if;
end;
$$;
grant execute on function public.set_workspace_trash_state(uuid,boolean) to authenticated;

create or replace function public.set_student_trash_state(p_id uuid, p_restore boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.students%rowtype; caller uuid := (select auth.uid());
begin
  select * into target from public.students where id=p_id;
  if not found then raise exception 'Không tìm thấy hồ sơ sinh viên'; end if;
  if target.owner_id <> caller and not public.is_system_admin() then raise exception 'Không có quyền với hồ sơ này'; end if;
  if p_restore then
    if not public.can_access_module('students','restore') then raise exception 'Không có quyền khôi phục'; end if;
    update public.students set deleted_at=null where id=p_id;
  else
    if not public.can_access_module('students','delete') then raise exception 'Không có quyền chuyển vào thùng rác'; end if;
    update public.students set deleted_at=now() where id=p_id and deleted_at is null;
  end if;
end;
$$;
grant execute on function public.set_student_trash_state(uuid,boolean) to authenticated;

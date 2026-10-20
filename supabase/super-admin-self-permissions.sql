-- Run after security.sql. Super Admins can manage user-specific overrides for themselves only.
create or replace function public.set_user_module_permission(p_user_id uuid, p_module text, p_action text, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); target_role text;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Khong co quyen cau hinh RBAC'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Khong tim thay tai khoan'; end if;
  if target_role = 'super_admin' and not (caller_role = 'super_admin' and p_user_id = (select auth.uid())) then
    raise exception 'Chi Super Admin dang dang nhap moi duoc sua quyen rieng cua chinh minh';
  end if;
  insert into public.user_module_permissions (user_id,module_key,action_key,allowed,updated_at)
  values (p_user_id,p_module,p_action,p_allowed,now())
  on conflict (user_id,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();
end;
$$;
grant execute on function public.set_user_module_permission(uuid,text,text,boolean) to authenticated;

create or replace function public.get_user_access_matrix(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller_role text := public.current_role_key();
  target_role text;
  permission_json jsonb;
begin
  if caller_role not in ('super_admin','system_admin','sub_admin') then raise exception 'Khong co quyen xem ma tran nguoi dung'; end if;
  select role_key into target_role from public.user_profiles where user_id = p_user_id;
  if target_role is null then raise exception 'Khong tim thay tai khoan'; end if;
  if target_role = 'super_admin' and p_user_id <> (select auth.uid()) then
    return jsonb_build_object('role',target_role,'superAdmin',true,'permissions','{}'::jsonb);
  end if;
  select coalesce(jsonb_object_agg(module_key,actions),'{}'::jsonb) into permission_json from (
    select module_key,jsonb_object_agg(action_key,allowed) as actions from (
      select distinct on (module_key,action_key) module_key,action_key,allowed from (
        select module_key,action_key,allowed,0 as priority from public.role_module_permissions where role_key=target_role
        union all
        select module_key,action_key,allowed,1 as priority from public.user_module_permissions where user_id=p_user_id
      ) as candidates order by module_key,action_key,priority desc
    ) as effective group by module_key
  ) as grouped;
  return jsonb_build_object('role',target_role,'superAdmin',target_role='super_admin','permissions',permission_json);
end;
$$;
grant execute on function public.get_user_access_matrix(uuid) to authenticated;

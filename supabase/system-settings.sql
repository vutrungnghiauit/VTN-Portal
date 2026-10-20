-- Run after security.sql. Global NTTU/FBA settings are readable by signed-in users and writable by admins.
create table if not exists public.system_settings (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (id,data) values (true, jsonb_build_object(
  'school_name','Trường Đại học Nguyễn Tất Thành',
  'faculty','Khoa Quản trị kinh doanh',
  'academic_year','',
  'current_semester','',
  'school_address','331 Đỗ Mười, Phường An Phú Đông, Thành phố Hồ Chí Minh',
  'school_email','qtkd@ntt.edu.vn',
  'school_hotline','',
  'education_philosophy','Thực học - Thực hành - Thực danh - Thực nghiệp',
  'lecturer_code','NTT-03315',
  'lecturer_name','Vũ Trung Nghĩa',
  'lecturer_degree','Thạc sĩ',
  'lecturer_title','Giảng viên',
  'lecturer_department','Kinh tế số',
  'lecturer_email','vtnghia@ntt.edu.vn',
  'lecturer_phone','1900 2039',
  'lecturer_office','331 Đỗ Mười, Phường An Phú Đông, Thành phố Hồ Chí Minh',
  'trash_retention_days',30
)) on conflict (id) do nothing;

create table if not exists public.system_backups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.system_settings enable row level security;
alter table public.system_backups enable row level security;
drop policy if exists "Authenticated users read system settings" on public.system_settings;
create policy "Authenticated users read system settings" on public.system_settings for select to authenticated using (true);
drop policy if exists "Admins read system backups" on public.system_backups;
create policy "Admins read system backups" on public.system_backups for select to authenticated using (public.is_system_admin());
grant select on public.system_settings, public.system_backups to authenticated;
revoke insert, update, delete on public.system_settings, public.system_backups from anon, authenticated;

create or replace function public.save_system_settings(p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); old_data jsonb;
begin
  if not public.is_system_admin() or not public.can_access_module('settings','update') then raise exception 'Chỉ admin được sửa cài đặt hệ thống'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Cấu hình không hợp lệ'; end if;
  select data into old_data from public.system_settings where id = true for update;
  if old_data is null then raise exception 'Chưa khởi tạo cài đặt hệ thống'; end if;
  insert into public.system_backups (created_by,reason,snapshot) values (caller,'Tự động sao lưu trước khi cập nhật cài đặt',jsonb_build_object('settings',old_data));
  update public.system_settings set data = p_data, updated_by = caller, updated_at = now() where id = true;
end;
$$;
grant execute on function public.save_system_settings(jsonb) to authenticated;

create or replace function public.create_system_settings_backup(p_reason text default 'Sao lưu thủ công')
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); old_data jsonb; backup_id uuid;
begin
  if not public.is_system_admin() or not public.can_access_module('backup','create') then raise exception 'Chỉ admin được tạo snapshot hệ thống'; end if;
  select data into old_data from public.system_settings where id=true;
  insert into public.system_backups (created_by,reason,snapshot) values (caller,coalesce(nullif(trim(p_reason),''),'Sao lưu thủ công'),jsonb_build_object('settings',old_data)) returning id into backup_id;
  return backup_id;
end;
$$;
grant execute on function public.create_system_settings_backup(text) to authenticated;

create or replace function public.restore_system_settings_backup(p_backup_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); old_data jsonb; restore_data jsonb;
begin
  if not public.is_system_admin() or not public.can_access_module('settings','update') then raise exception 'Chỉ admin được khôi phục cài đặt'; end if;
  select data into old_data from public.system_settings where id = true for update;
  select snapshot -> 'settings' into restore_data from public.system_backups where id = p_backup_id;
  if restore_data is null then raise exception 'Không tìm thấy bản sao lưu cấu hình'; end if;
  insert into public.system_backups (created_by,reason,snapshot) values (caller,'Tự động sao lưu trước khi rollback',jsonb_build_object('settings',old_data));
  update public.system_settings set data = restore_data, updated_by = caller, updated_at = now() where id = true;
end;
$$;
grant execute on function public.restore_system_settings_backup(uuid) to authenticated;

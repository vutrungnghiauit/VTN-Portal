-- Run in Supabase SQL Editor after workspace.sql and security.sql.
-- Removes all active and trashed records owned by the retired modules.
begin;

delete from public.workspace_records
where module_key in ('courses-classes', 'classes');

delete from public.role_module_permissions
where module_key in ('courses-classes', 'classes');

delete from public.user_module_permissions
where module_key in ('courses-classes', 'classes');

-- Keep timetable rows, but remove stale references to the deleted module records.
update public.workspace_records
set data = data - 'courseId' - 'classId', updated_at = now()
where module_key = 'timetables'
  and (data ? 'courseId' or data ? 'classId');

commit;

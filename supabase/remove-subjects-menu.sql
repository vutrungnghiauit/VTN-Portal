-- Run in Supabase SQL Editor after workspace.sql and security.sql.
-- The student records table is intentionally preserved: the remaining
-- "Hồ sơ sinh viên" menu continues to use public.students.
begin;

delete from public.workspace_records
where module_key = 'subjects';

delete from public.role_module_permissions
where module_key = 'subjects';

delete from public.user_module_permissions
where module_key = 'subjects';

-- Timetable rows retain their own subject name/code/credit data.
-- Remove only the foreign-key-like pointer to the retired catalog entry.
update public.workspace_records
set data = data - 'subjectId', updated_at = now()
where module_key = 'timetables' and data ? 'subjectId';

commit;

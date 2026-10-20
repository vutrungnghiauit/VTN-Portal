-- Run in Supabase SQL Editor after workspace.sql and security.sql.
-- Deletes only records in the retired attendance workspace module.
-- Random Picker roll-call history is stored separately and is not affected.
begin;

delete from public.workspace_records
where module_key = 'attendance';

delete from public.role_module_permissions
where module_key = 'attendance';

delete from public.user_module_permissions
where module_key = 'attendance';

commit;

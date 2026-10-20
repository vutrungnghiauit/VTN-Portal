-- Run in Supabase SQL Editor after workspace.sql and security.sql.
-- Removes active and trashed records for the retired Reports module.
begin;

delete from public.workspace_records
where module_key = 'reports';

delete from public.role_module_permissions
where module_key = 'reports';

delete from public.user_module_permissions
where module_key = 'reports';

commit;

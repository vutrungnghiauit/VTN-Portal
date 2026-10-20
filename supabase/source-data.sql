-- Grant staff access to the shared source-data workspace. Run after security.sql.
insert into public.role_module_permissions(role_key, module_key, action_key, allowed)
values
  ('system_admin', 'source-data', 'read', true),
  ('system_admin', 'source-data', 'create', true),
  ('system_admin', 'source-data', 'update', true),
  ('system_admin', 'source-data', 'delete', true),
  ('system_admin', 'source-data', 'export', true),
  ('sub_admin', 'source-data', 'read', true),
  ('sub_admin', 'source-data', 'create', true),
  ('sub_admin', 'source-data', 'update', true),
  ('sub_admin', 'source-data', 'delete', true),
  ('sub_admin', 'source-data', 'export', true),
  ('teacher', 'source-data', 'read', true),
  ('teacher', 'source-data', 'create', true),
  ('teacher', 'source-data', 'update', true),
  ('teacher', 'source-data', 'delete', true),
  ('teacher', 'source-data', 'export', true),
  ('assistant', 'source-data', 'read', true),
  ('assistant', 'source-data', 'create', true),
  ('assistant', 'source-data', 'update', true),
  ('assistant', 'source-data', 'delete', true),
  ('assistant', 'source-data', 'export', true)
on conflict (role_key, module_key, action_key)
do update set allowed = excluded.allowed, updated_at = now();

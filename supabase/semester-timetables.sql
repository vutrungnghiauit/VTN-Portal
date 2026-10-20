-- Run after security.sql and workspace.sql.
-- Stores imported semester schedule rows idempotently for each account owner.
alter table public.workspace_records add column if not exists external_id text;
create unique index if not exists workspace_records_external_id_unique
  on public.workspace_records(owner_id, module_key, external_id);

insert into public.role_module_permissions(role_key, module_key, action_key, allowed)
values
  ('teacher','timetables','read',true),
  ('teacher','timetables','create',true),
  ('teacher','timetables','update',true),
  ('teacher','timetables','delete',true),
  ('teacher','timetables','export',true),
  ('system_admin','timetables','read',true),
  ('system_admin','timetables','create',true),
  ('system_admin','timetables','update',true),
  ('system_admin','timetables','delete',true),
  ('system_admin','timetables','export',true),
  ('sub_admin','timetables','read',true),
  ('sub_admin','timetables','create',true),
  ('sub_admin','timetables','update',true),
  ('sub_admin','timetables','delete',true),
  ('sub_admin','timetables','export',true)
on conflict (role_key, module_key, action_key)
do update set allowed = excluded.allowed, updated_at = now();

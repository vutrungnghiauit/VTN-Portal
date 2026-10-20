-- Run after security.sql to add separate snapshot/import permissions.
alter table public.role_module_permissions drop constraint if exists role_module_permissions_action_key_check;
alter table public.role_module_permissions add constraint role_module_permissions_action_key_check check (action_key in ('read','create','update','delete','restore','export','backup','import'));
alter table public.user_module_permissions drop constraint if exists user_module_permissions_action_key_check;
alter table public.user_module_permissions add constraint user_module_permissions_action_key_check check (action_key in ('read','create','update','delete','restore','export','backup','import'));
insert into public.role_module_permissions(role_key,module_key,action_key,allowed)
select r.role_key,m.module_key,a.action_key,
  case when r.role_key in ('system_admin','sub_admin') then true else false end
from (values ('system_admin'),('sub_admin'),('teacher'),('assistant'),('class_president'),('class_vice'),('student')) r(role_key)
cross join (values ('dashboard'),('academic-years'),('semesters'),('students'),('student-records'),('groups'),('teaching-plans'),('calendar'),('grades'),('assignments'),('tasks'),('student-support'),('documents'),('source-data'),('forms-templates'),('surveys'),('notifications'),('announcements'),('supports'),('random-picker'),('my-profile'),('accounts'),('permissions'),('audit-logs'),('backup'),('trash'),('settings')) m(module_key)
cross join (values ('backup'),('import')) a(action_key)
on conflict(role_key,module_key,action_key) do nothing;

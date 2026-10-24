-- Run after rbac-actions.sql to add the course sections module to existing projects.
-- Existing role choices are preserved; only missing permission rows are created.
insert into public.role_module_permissions(role_key, module_key, action_key, allowed)
select roles.role_key, 'course-sections', actions.action_key,
  case
    when roles.role_key in ('system_admin', 'sub_admin', 'teacher') then true
    when roles.role_key = 'assistant' then actions.action_key in ('read', 'create', 'update', 'import')
    else false
  end
from (values ('system_admin'), ('sub_admin'), ('teacher'), ('assistant'), ('class_president'), ('class_vice'), ('student')) as roles(role_key)
cross join (values ('read'), ('create'), ('update'), ('delete'), ('restore'), ('export'), ('import')) as actions(action_key)
on conflict (role_key, module_key, action_key) do nothing;

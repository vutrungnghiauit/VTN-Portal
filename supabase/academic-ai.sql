-- Học vụ AI: run after security.sql and enable the academic-ai module in RBAC.
create table if not exists public.academic_ai_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  openai_file_id text not null,
  vector_store_id text not null,
  status text not null default 'ready' check (status in ('processing','ready','failed')),
  uploaded_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.academic_ai_sources add column if not exists deleted_at timestamptz;
alter table public.academic_ai_sources add column if not exists purge_at timestamptz;

alter table public.academic_ai_sources enable row level security;
drop policy if exists "Academic AI sources are visible to permitted users" on public.academic_ai_sources;
create policy "Academic AI sources are visible to permitted users"
  on public.academic_ai_sources for select to authenticated
  using (deleted_at is null and public.can_access_module('academic-ai','read'));
drop policy if exists "Academic AI source managers can add sources" on public.academic_ai_sources;
create policy "Academic AI source managers can add sources"
  on public.academic_ai_sources for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and public.can_access_module('academic-ai','create'));
drop policy if exists "Academic AI source managers can update sources" on public.academic_ai_sources;
create policy "Academic AI source managers can update sources"
  on public.academic_ai_sources for update to authenticated
  using (public.can_access_module('academic-ai','update'))
  with check (public.can_access_module('academic-ai','update'));
drop policy if exists "Academic AI source managers can remove sources" on public.academic_ai_sources;
create policy "Academic AI source managers can remove sources"
  on public.academic_ai_sources for delete to authenticated
  using (deleted_at is not null and public.can_access_module('academic-ai','delete'));

grant select, insert, update, delete on public.academic_ai_sources to authenticated;
revoke all on public.academic_ai_sources from anon;

insert into public.role_module_permissions(role_key,module_key,action_key,allowed)
select roles.role_key, 'academic-ai', actions.action_key,
  case
    when roles.role_key in ('system_admin','sub_admin') then true
    when roles.role_key = 'teacher' then actions.action_key in ('read','create','update','delete','export')
    when roles.role_key in ('assistant','student') then actions.action_key = 'read'
    else false
  end
from (values ('system_admin'),('sub_admin'),('teacher'),('assistant'),('class_president'),('class_vice'),('student')) as roles(role_key)
cross join (values ('read'),('create'),('update'),('delete'),('restore'),('export')) as actions(action_key)
on conflict (role_key,module_key,action_key) do update set allowed = excluded.allowed, updated_at = now();

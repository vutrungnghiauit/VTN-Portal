-- Shared storage for the remaining teaching modules. Every authenticated teacher owns their rows.
create table if not exists public.workspace_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null check (length(trim(module_key)) > 0),
  external_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_at timestamptz
);
alter table public.workspace_records add column if not exists purge_at timestamptz;
alter table public.workspace_records add column if not exists external_id text;
create unique index if not exists workspace_records_external_id_unique
  on public.workspace_records(owner_id, module_key, external_id);

create index if not exists workspace_owner_module_updated_idx
  on public.workspace_records (owner_id, module_key, updated_at desc);
create index if not exists workspace_owner_trash_idx
  on public.workspace_records (owner_id, deleted_at desc)
  where deleted_at is not null;

create or replace function public.set_workspace_record_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists workspace_records_updated_at on public.workspace_records;
create trigger workspace_records_updated_at
  before update on public.workspace_records
  for each row execute function public.set_workspace_record_updated_at();

alter table public.workspace_records enable row level security;
drop policy if exists "Teachers can read their own workspace records" on public.workspace_records;
create policy "Teachers can read their own workspace records"
  on public.workspace_records for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists "Teachers can add their own workspace records" on public.workspace_records;
create policy "Teachers can add their own workspace records"
  on public.workspace_records for insert to authenticated
  with check ((select auth.uid()) = owner_id);
drop policy if exists "Teachers can update their own workspace records" on public.workspace_records;
create policy "Teachers can update their own workspace records"
  on public.workspace_records for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
drop policy if exists "Teachers can delete their own trashed workspace records" on public.workspace_records;
create policy "Teachers can delete their own trashed workspace records"
  on public.workspace_records for delete to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is not null);

grant select, insert, update, delete on public.workspace_records to authenticated;
revoke all on public.workspace_records from anon;

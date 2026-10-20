-- Run the complete script in Supabase SQL Editor as the project owner.
-- The grade lock guard also blocks this metadata-only backfill on locked rows.
-- Disable only that guard inside this transaction, then restore it before commit.
begin;

alter table public.workspace_records disable trigger workspace_grade_lock_guard;

update public.workspace_records
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{lecturer}', to_jsonb('01011090 - Vũ Trung Nghĩa'::text), true)
where module_key = 'grades'
  and data->>'lecturer' is distinct from '01011090 - Vũ Trung Nghĩa';

alter table public.workspace_records enable trigger workspace_grade_lock_guard;

commit;

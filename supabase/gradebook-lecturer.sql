-- Backfill the lecturer shown for every existing gradebook row.
update public.workspace_records
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{lecturer}', to_jsonb('01011090 - Vũ Trung Nghĩa'::text), true)
where module_key = 'grades';

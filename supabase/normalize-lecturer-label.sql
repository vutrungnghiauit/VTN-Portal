-- Standardize the lecturer label in persisted timetable / teaching schedule rows.
-- Run in Supabase SQL Editor as the project owner.
update public.workspace_records
set data = jsonb_set(
  data,
  '{lecturer}',
  to_jsonb('01011090 - ' || U&'V\0169 Trung Ngh\0129a'),
  false
),
updated_at = now()
where data->>'lecturer' = U&'V\0169 Trung Ngh\0129a (01011090)';

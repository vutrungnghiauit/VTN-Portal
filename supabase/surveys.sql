-- Survey definitions and responses with per-owner result visibility.
-- Run workspace.sql and security.sql before this script.

drop policy if exists "Survey users read shared survey definitions" on public.workspace_records;
drop policy if exists "Survey editors read owned or all definitions" on public.workspace_records;
create policy "Survey editors read owned or all definitions"
  on public.workspace_records for select to authenticated
  using (
    module_key = 'surveys' and deleted_at is null
    and (
      public.is_system_admin()
      or (
        public.current_role_key() in ('teacher', 'assistant')
        and owner_id = (select auth.uid())
        and public.can_access_module('surveys', 'read')
      )
      or (
        public.current_role_key() in ('student', 'class_president', 'class_vice')
        and public.can_access_module('surveys', 'read')
        and lower(coalesce(data ->> 'audience', 'student')) not like '%giảng viên%'
        and lower(coalesce(data ->> 'audience', 'student')) not like '%faculty%'
      )
    )
  );

drop policy if exists "Survey editors update shared definitions" on public.workspace_records;
drop policy if exists "Survey editors update owned definitions" on public.workspace_records;
create policy "Survey editors update owned definitions"
  on public.workspace_records for update to authenticated
  using (
    module_key = 'surveys'
    and public.can_access_module('surveys', 'update')
    and (public.is_system_admin() or (owner_id = (select auth.uid()) and public.current_role_key() in ('teacher', 'assistant')))
  )
  with check (
    module_key = 'surveys'
    and public.can_access_module('surveys', 'update')
    and (public.is_system_admin() or (owner_id = (select auth.uid()) and public.current_role_key() in ('teacher', 'assistant')))
  );

create or replace function public.set_survey_trash_state(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.workspace_records%rowtype;
  caller uuid := (select auth.uid());
begin
  select * into target from public.workspace_records where id = p_id;
  if not found or target.module_key <> 'surveys' then raise exception 'Survey not found'; end if;
  if not public.can_access_module('surveys', 'delete') then raise exception 'Survey delete permission required'; end if;
  if target.owner_id <> caller and not public.is_system_admin() then raise exception 'Only the survey owner or an admin may delete it'; end if;
  update public.workspace_records set deleted_at = now() where id = p_id and deleted_at is null;
end;
$$;
revoke all on function public.set_survey_trash_state(uuid) from public, anon;
grant execute on function public.set_survey_trash_state(uuid) to authenticated;

create table if not exists public.survey_responses (
  survey_id uuid not null references public.workspace_records(id) on delete cascade,
  respondent_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  answers jsonb not null default '{}'::jsonb,
  comment text not null default '',
  respondent_name text not null default 'Sinh viên',
  class_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (survey_id, respondent_id)
);

-- Add education survey fields when upgrading an existing rating-only install.
alter table public.survey_responses add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.survey_responses add column if not exists comment text not null default '';
alter table public.survey_responses add column if not exists respondent_name text not null default 'Sinh viên';
alter table public.survey_responses add column if not exists class_name text not null default '';
create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);

create table if not exists public.survey_response_scopes (
  respondent_id uuid not null references auth.users(id) on delete cascade,
  survey_owner_id uuid not null references auth.users(id) on delete cascade,
  semester_key text not null,
  course_key text not null,
  survey_id uuid not null references public.workspace_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (respondent_id, survey_owner_id, semester_key, course_key)
);
alter table public.survey_response_scopes enable row level security;
revoke all on public.survey_response_scopes from public, anon, authenticated;

-- Preserve the once-per-lecturer/course/semester limit for responses submitted before this upgrade.
insert into public.survey_response_scopes (respondent_id, survey_owner_id, semester_key, course_key, survey_id, created_at)
select distinct on (r.respondent_id, s.owner_id,
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'semesterName', ''), '__all__')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'courseName', ''), nullif(s.data ->> 'title', ''), '')), '\s+', ' ', 'g')))
  r.respondent_id, s.owner_id,
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'semesterName', ''), '__all__')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'courseName', ''), nullif(s.data ->> 'title', ''), '')), '\s+', ' ', 'g')),
  s.id, r.created_at
from public.survey_responses r
join public.workspace_records s on s.id = r.survey_id
where s.module_key = 'surveys' and s.owner_id is not null
  and trim(coalesce(nullif(s.data ->> 'courseName', ''), nullif(s.data ->> 'title', ''), '')) <> ''
order by r.respondent_id, s.owner_id,
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'semesterName', ''), '__all__')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(nullif(s.data ->> 'courseName', ''), nullif(s.data ->> 'title', ''), '')), '\s+', ' ', 'g')),
  r.created_at asc
on conflict (respondent_id, survey_owner_id, semester_key, course_key) do nothing;

create or replace function public.set_survey_response_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists survey_responses_updated_at on public.survey_responses;
create trigger survey_responses_updated_at before update on public.survey_responses
for each row execute function public.set_survey_response_updated_at();

create or replace function public.enforce_survey_student_period_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_owner uuid;
  target_data jsonb;
  target_course text;
  target_term text;
  existing_survey_id uuid;
begin
  if public.current_role_key() not in ('student', 'class_president', 'class_vice') then
    return new;
  end if;

  select owner_id, data into target_owner, target_data
  from public.workspace_records
  where id = new.survey_id and module_key = 'surveys' and deleted_at is null;
  if not found then raise exception 'Survey not found or inactive'; end if;

  target_course := lower(regexp_replace(trim(coalesce(nullif(target_data ->> 'courseName', ''), nullif(target_data ->> 'title', ''), '')), '\s+', ' ', 'g'));
  target_term := lower(regexp_replace(trim(coalesce(nullif(target_data ->> 'semesterName', ''), '__all__')), '\s+', ' ', 'g'));
  if target_course = '' then raise exception 'Survey must identify its course'; end if;

  insert into public.survey_response_scopes (respondent_id, survey_owner_id, semester_key, course_key, survey_id)
  values (new.respondent_id, target_owner, target_term, target_course, new.survey_id)
  on conflict (respondent_id, survey_owner_id, semester_key, course_key) do nothing;
  select survey_id into existing_survey_id from public.survey_response_scopes
  where respondent_id = new.respondent_id and survey_owner_id = target_owner
    and semester_key = target_term and course_key = target_course;

  if existing_survey_id <> new.survey_id then
    raise exception 'You have already completed this lecturer course survey for the selected semester';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_survey_student_period_limit() from public, anon;
drop trigger if exists survey_student_period_limit on public.survey_responses;
create trigger survey_student_period_limit before insert or update on public.survey_responses
for each row execute function public.enforce_survey_student_period_limit();

alter table public.survey_responses enable row level security;
drop policy if exists "Respondents read their survey ratings" on public.survey_responses;
drop policy if exists "Respondents read their survey responses" on public.survey_responses;
create policy "Respondents read their survey responses" on public.survey_responses for select to authenticated
  using (respondent_id = (select auth.uid()) and public.can_access_module('surveys', 'read'));
drop policy if exists "Survey editors read all responses" on public.survey_responses;
drop policy if exists "Survey owners and admins read responses" on public.survey_responses;
create policy "Survey owners and admins read responses" on public.survey_responses for select to authenticated
  using (
    exists (
      select 1 from public.workspace_records s
      where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
        and (
          public.is_system_admin()
          or (s.owner_id = (select auth.uid()) and public.current_role_key() in ('teacher', 'assistant') and public.can_access_module('surveys', 'read'))
        )
    )
  );
drop policy if exists "Respondents submit their survey ratings" on public.survey_responses;
drop policy if exists "Respondents submit survey responses" on public.survey_responses;
create policy "Respondents submit survey responses" on public.survey_responses for insert to authenticated
  with check (
    respondent_id = (select auth.uid())
    and public.current_role_key() in ('student', 'class_president', 'class_vice')
    and public.can_access_module('surveys', 'read')
    and exists (
      select 1 from public.workspace_records s
      where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
        and lower(coalesce(s.data ->> 'status', '')) not in ('closed', 'completed', 'đã kết thúc', 'đã đóng', 'hoàn thành')
        and lower(coalesce(s.data ->> 'audience', 'student')) not like '%giảng viên%'
        and lower(coalesce(s.data ->> 'audience', 'student')) not like '%faculty%'
        and (nullif(s.data ->> 'dueDate', '') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'))
    )
  );
drop policy if exists "Respondents update their survey ratings" on public.survey_responses;
drop policy if exists "Respondents update survey responses" on public.survey_responses;
create policy "Respondents update survey responses" on public.survey_responses for update to authenticated
  using (respondent_id = (select auth.uid()) and public.can_access_module('surveys', 'read'))
  with check (
    respondent_id = (select auth.uid())
    and public.current_role_key() in ('student', 'class_president', 'class_vice')
    and public.can_access_module('surveys', 'read')
    and exists (
      select 1 from public.workspace_records s
      where s.id = survey_id and s.module_key = 'surveys' and s.deleted_at is null
        and lower(coalesce(s.data ->> 'status', '')) not in ('closed', 'completed', 'đã kết thúc', 'đã đóng', 'hoàn thành')
        and lower(coalesce(s.data ->> 'audience', 'student')) not like '%giảng viên%'
        and lower(coalesce(s.data ->> 'audience', 'student')) not like '%faculty%'
        and (nullif(s.data ->> 'dueDate', '') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'))
    )
  );

grant select, insert, update on public.survey_responses to authenticated;
revoke all on public.survey_responses from public, anon;

create or replace function public.get_survey_rating_summary()
returns table (average_rating numeric, response_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_role_key() not in ('super_admin', 'system_admin', 'sub_admin', 'teacher', 'assistant') then
    return query select 0::numeric, 0::bigint;
    return;
  end if;

  return query
  select coalesce(round(avg(r.rating)::numeric, 1), 0::numeric), count(*)::bigint
  from public.survey_responses r
  join public.workspace_records s on s.id = r.survey_id
  where s.module_key = 'surveys' and s.deleted_at is null
    and (
      public.is_system_admin()
      or (s.owner_id = (select auth.uid()) and public.current_role_key() in ('teacher', 'assistant') and public.can_access_module('surveys', 'read'))
    );
end;
$$;
revoke all on function public.get_survey_rating_summary() from public, anon;
grant execute on function public.get_survey_rating_summary() to authenticated;

-- Keep the dashboard card current when a rating is submitted.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'survey_responses') then
    alter publication supabase_realtime add table public.survey_responses;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is unavailable; enable it in Supabase Database publications.';
end;
$$;

-- Private answer attachments. Paths are survey_id/respondent_id/question_id/file_name.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vtn-survey-response-files', 'vtn-survey-response-files', false, 10485760, null)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Survey respondents upload answer files" on storage.objects;
create policy "Survey respondents upload answer files" on storage.objects for insert to authenticated
with check (
  bucket_id = 'vtn-survey-response-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.current_role_key() in ('student', 'class_president', 'class_vice')
  and public.can_access_module('surveys', 'read')
  and exists (
    select 1 from public.workspace_records s
    where s.id::text = (storage.foldername(name))[1]
      and s.module_key = 'surveys' and s.deleted_at is null
      and lower(coalesce(s.data ->> 'status', '')) not in ('closed', 'completed', 'đã kết thúc', 'đã đóng', 'hoàn thành')
      and lower(coalesce(s.data ->> 'audience', 'student')) not like '%giảng viên%'
      and lower(coalesce(s.data ->> 'audience', 'student')) not like '%faculty%'
      and (nullif(s.data ->> 'dueDate', '') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'))
  )
);

drop policy if exists "Survey participants and owners read answer files" on storage.objects;
create policy "Survey participants and owners read answer files" on storage.objects for select to authenticated
using (
  bucket_id = 'vtn-survey-response-files'
  and (
    ((storage.foldername(name))[2] = (select auth.uid())::text and exists (
      select 1 from public.survey_responses r
      where r.survey_id::text = (storage.foldername(name))[1] and r.respondent_id = (select auth.uid())
    ))
    or exists (
      select 1 from public.workspace_records s
      where s.id::text = (storage.foldername(name))[1]
        and s.module_key = 'surveys' and s.deleted_at is null
        and (
          public.is_system_admin()
          or (s.owner_id = (select auth.uid()) and public.current_role_key() in ('teacher', 'assistant') and public.can_access_module('surveys', 'read'))
        )
    )
  )
);

drop policy if exists "Survey respondents delete own answer files" on storage.objects;
create policy "Survey respondents delete own answer files" on storage.objects for delete to authenticated
using (
  bucket_id = 'vtn-survey-response-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.can_access_module('surveys', 'read')
  and exists (
    select 1 from public.workspace_records s
    where s.id::text = (storage.foldername(name))[1]
      and s.module_key = 'surveys' and s.deleted_at is null
      and lower(coalesce(s.data ->> 'status', '')) not in ('closed', 'completed', 'đã kết thúc', 'đã đóng', 'hoàn thành')
      and (nullif(s.data ->> 'dueDate', '') is null or s.data ->> 'dueDate' >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'))
  )
);

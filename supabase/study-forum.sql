-- Run after security.sql and audit.sql.
create table if not exists public.study_forum_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 180),
  category text not null default 'Thảo luận chung' check (length(category) <= 60),
  description text not null check (length(btrim(description)) between 1 and 5000),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default 'Thành viên',
  author_role text not null default 'student',
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table if not exists public.study_forum_messages (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.study_forum_topics(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 5000),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default 'Thành viên',
  author_role text not null default 'student',
  created_at timestamptz not null default now()
);

create index if not exists study_forum_topics_activity_idx on public.study_forum_topics(last_activity_at desc);
create index if not exists study_forum_messages_topic_time_idx on public.study_forum_messages(topic_id, created_at);
alter table public.study_forum_topics enable row level security;
alter table public.study_forum_messages enable row level security;

drop policy if exists "Forum members read topics" on public.study_forum_topics;
create policy "Forum members read topics" on public.study_forum_topics for select to authenticated
  using (public.can_access_module('groups','read'));
drop policy if exists "Forum members create topics" on public.study_forum_topics;
create policy "Forum members create topics" on public.study_forum_topics for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_access_module('groups','create'));
drop policy if exists "Forum members read messages" on public.study_forum_messages;
create policy "Forum members read messages" on public.study_forum_messages for select to authenticated
  using (public.can_access_module('groups','read') and exists (
    select 1 from public.study_forum_topics topic where topic.id = topic_id
  ));
drop policy if exists "Forum members reply to topics" on public.study_forum_messages;
create policy "Forum members reply to topics" on public.study_forum_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_access_module('groups','create') and exists (
    select 1 from public.study_forum_topics topic where topic.id = topic_id
  ));
grant select, insert on public.study_forum_topics, public.study_forum_messages to authenticated;
revoke all on public.study_forum_topics, public.study_forum_messages from anon;

create or replace function public.set_study_forum_author()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is distinct from (select auth.uid()) then raise exception 'Không thể đăng bài thay tài khoản khác'; end if;
  select coalesce(nullif(display_name,''), username, 'Thành viên'), role_key
    into new.author_name, new.author_role from public.user_profiles where user_id = new.author_id;
  if new.author_name is null then new.author_name := 'Thành viên'; end if;
  if new.author_role is null then new.author_role := 'student'; end if;
  return new;
end;
$$;
drop trigger if exists study_forum_topic_author on public.study_forum_topics;
create trigger study_forum_topic_author before insert on public.study_forum_topics
  for each row execute function public.set_study_forum_author();
drop trigger if exists study_forum_message_author on public.study_forum_messages;
create trigger study_forum_message_author before insert on public.study_forum_messages
  for each row execute function public.set_study_forum_author();

create or replace function public.touch_study_forum_topic()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.study_forum_topics set last_activity_at = new.created_at where id = new.topic_id;
  return new;
end;
$$;
drop trigger if exists study_forum_message_activity on public.study_forum_messages;
create trigger study_forum_message_activity after insert on public.study_forum_messages
  for each row execute function public.touch_study_forum_topic();

create or replace function public.audit_study_forum_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb := to_jsonb(new); topic_title text; module_label text;
begin
  if tg_table_name = 'study_forum_topics' then
    module_label := new.title;
  else
    select title into topic_title from public.study_forum_topics where id = new.topic_id;
    module_label := coalesce(topic_title, 'Chủ đề diễn đàn');
  end if;
  insert into public.system_audit_logs(actor_id, subject_user_id, module_key, action, source_table, record_id, record_label, details)
  values ((select auth.uid()), new.author_id, 'groups', case when tg_table_name = 'study_forum_topics' then 'create_topic' else 'send_message' end,
    tg_table_name, new.id, module_label, jsonb_build_object('content', coalesce(row_data->>'content', row_data->>'description')));
  return new;
end;
$$;
drop trigger if exists study_forum_topic_audit on public.study_forum_topics;
create trigger study_forum_topic_audit after insert on public.study_forum_topics
  for each row execute function public.audit_study_forum_activity();
drop trigger if exists study_forum_message_audit on public.study_forum_messages;
create trigger study_forum_message_audit after insert on public.study_forum_messages
  for each row execute function public.audit_study_forum_activity();

-- Enable student and class officer access to the forum by default.
update public.role_module_permissions set allowed = true, updated_at = now()
  where role_key in ('student','class_president','class_vice') and module_key = 'groups' and action_key in ('read','create');
insert into public.role_module_permissions(role_key,module_key,action_key,allowed)
  values ('student','groups','read',true),('student','groups','create',true),
    ('class_president','groups','read',true),('class_president','groups','create',true),
    ('class_vice','groups','read',true),('class_vice','groups','create',true)
  on conflict (role_key,module_key,action_key) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_forum_topics') then
      alter publication supabase_realtime add table public.study_forum_topics;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_forum_messages') then
      alter publication supabase_realtime add table public.study_forum_messages;
    end if;
  end if;
end $$;

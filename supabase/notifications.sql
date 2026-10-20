-- Run after security.sql. Notifications are fan-out records; students only read their inbox.
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  severity text not null check (severity in ('normal','important','urgent')),
  scope text not null check (scope in ('school','class')),
  class_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.app_notification_recipients (
  notification_id uuid not null references public.app_notifications(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  primary key (notification_id, recipient_id)
);
create index if not exists app_notification_recipient_inbox_idx on public.app_notification_recipients (recipient_id, read_at);

alter table public.app_notifications enable row level security;
alter table public.app_notification_recipients enable row level security;
drop policy if exists "Recipients read their notifications" on public.app_notifications;
create policy "Recipients read their notifications" on public.app_notifications for select to authenticated
  using (exists (select 1 from public.app_notification_recipients r where r.notification_id = id and r.recipient_id = (select auth.uid())));
drop policy if exists "Users read their notification inbox" on public.app_notification_recipients;
create policy "Users read their notification inbox" on public.app_notification_recipients for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "Users mark their notifications read" on public.app_notification_recipients;
create policy "Users mark their notifications read" on public.app_notification_recipients for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
grant select on public.app_notifications, public.app_notification_recipients to authenticated;
grant update (read_at) on public.app_notification_recipients to authenticated;
revoke insert, delete on public.app_notifications, public.app_notification_recipients from anon, authenticated;

create or replace function public.publish_app_notification(p_title text,p_body text,p_severity text,p_scope text,p_class_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  role_key text := public.current_role_key();
  notice_id uuid;
begin
  if caller is null or not public.can_access_module('notifications','create') then raise exception 'Bạn không có quyền gửi thông báo'; end if;
  if role_key not in ('super_admin','system_admin','sub_admin','teacher') then raise exception 'Vai trò này chỉ được nhận thông báo'; end if;
  if p_severity not in ('normal','important','urgent') then raise exception 'Mức độ thông báo không hợp lệ'; end if;
  if p_scope not in ('school','class') then raise exception 'Phạm vi thông báo không hợp lệ'; end if;
  if p_scope = 'class' and nullif(trim(p_class_name),'') is null then raise exception 'Cần chọn lớp nhận thông báo'; end if;
  insert into public.app_notifications (sender_id,title,body,severity,scope,class_name)
  values (caller,trim(p_title),trim(p_body),p_severity,p_scope,nullif(trim(p_class_name),'')) returning id into notice_id;
  if p_scope = 'school' and role_key in ('super_admin','system_admin','sub_admin') then
    insert into public.app_notification_recipients (notification_id,recipient_id)
    select notice_id,user_id from public.user_profiles where role_key = 'student' and user_id <> caller;
  elsif p_scope = 'school' then
    insert into public.app_notification_recipients (notification_id,recipient_id)
    select notice_id,auth_user_id from public.students where owner_id = caller and auth_user_id is not null and deleted_at is null;
  else
    if role_key = 'teacher' then
      insert into public.app_notification_recipients (notification_id,recipient_id)
      select notice_id,auth_user_id from public.students where owner_id = caller and class_name = trim(p_class_name) and auth_user_id is not null and deleted_at is null;
    else
      insert into public.app_notification_recipients (notification_id,recipient_id)
      select notice_id,auth_user_id from public.students where class_name = trim(p_class_name) and auth_user_id is not null and deleted_at is null;
    end if;
  end if;
  return notice_id;
end;
$$;
grant execute on function public.publish_app_notification(text,text,text,text,text) to authenticated;

-- Enable realtime INSERT events for support tickets. RLS policies still scope visible rows.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_records') then
    alter publication supabase_realtime add table public.workspace_records;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is unavailable; enable it in Supabase Database publications.';
end;
$$;

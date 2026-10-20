-- Run after workspace.sql, source-data-files.sql, support-tickets.sql,
-- security.sql, audit.sql, trash-retention.sql, and support-ticket-management.sql.

alter table public.support_tickets add column if not exists ticket_code text;
alter table public.support_tickets add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.support_tickets add column if not exists creator_name text;
alter table public.support_tickets add column if not exists student_code text;
alter table public.support_tickets add column if not exists student_name text;
alter table public.support_tickets add column if not exists student_record_id uuid references public.students(id) on delete set null;
alter table public.support_tickets add column if not exists location text;
alter table public.support_tickets add column if not exists room text;
alter table public.support_tickets add column if not exists assignee_name text;
alter table public.support_tickets add column if not exists assignee_role text;
alter table public.support_tickets add column if not exists assignee_id uuid references auth.users(id) on delete set null;
alter table public.support_tickets add column if not exists image_path text;
alter table public.support_tickets add column if not exists source_workspace_record_id uuid references public.workspace_records(id) on delete set null;
alter table public.support_tickets add column if not exists priority text not null default 'normal';
alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
alter table public.support_tickets add constraint support_tickets_priority_check check (priority in ('low','normal','high','urgent'));
alter table public.support_tickets alter column student_user_id drop not null;

alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets add constraint support_tickets_status_check
  check (status in ('pending','assigned','in_progress','completed'));

update public.support_tickets t
set created_by = coalesce(t.created_by, t.student_user_id),
    creator_name = coalesce(t.creator_name, (select coalesce(nullif(p.display_name,''),nullif(p.username,'')) from public.user_profiles p where p.user_id = coalesce(t.created_by,t.student_user_id))),
    assignee_id = coalesce(t.assignee_id, t.teacher_id),
    assignee_name = coalesce(t.assignee_name, (select coalesce(nullif(p.display_name,''),nullif(p.username,'')) from public.user_profiles p where p.user_id = t.teacher_id)),
    assignee_role = coalesce(t.assignee_role, (select coalesce(nullif(p.job_title,''),nullif(p.department,''),case p.role_key when 'teacher' then 'Giảng viên' when 'assistant' then 'Trợ giảng' else 'Quản trị viên' end) from public.user_profiles p where p.user_id = t.teacher_id)),
    student_code = coalesce(t.student_code, s.student_code),
    student_name = coalesce(t.student_name, s.full_name),
    student_record_id = coalesce(t.student_record_id, s.id)
from public.students s
where s.auth_user_id = t.student_user_id;
update public.support_tickets set created_by = student_user_id where created_by is null;
create unique index if not exists support_tickets_code_unique on public.support_tickets(ticket_code) where ticket_code is not null;
create index if not exists support_tickets_student_code_idx on public.support_tickets(student_code, created_at desc);
create index if not exists support_tickets_student_record_created_idx on public.support_tickets(student_record_id, created_at desc);
create index if not exists support_tickets_assignee_created_idx on public.support_tickets(assignee_id, created_at desc) where assignee_id is not null;
create unique index if not exists support_tickets_legacy_record_unique on public.support_tickets(source_workspace_record_id) where source_workspace_record_id is not null;

create or replace function public.assign_support_ticket_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.ticket_code is null or trim(new.ticket_code) = '' then
    new.ticket_code := 'YC-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;
drop trigger if exists support_ticket_code_before_insert on public.support_tickets;
create trigger support_ticket_code_before_insert before insert on public.support_tickets
for each row execute function public.assign_support_ticket_code();
update public.support_tickets
set ticket_code = 'YC-' || to_char(created_at, 'YYYY') || '-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where ticket_code is null;

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null check (event_type in ('submitted','assigned','status_changed','note')),
  status text check (status is null or status in ('pending','assigned','in_progress','completed')),
  message text not null default '',
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Người dùng',
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket_created_idx on public.support_ticket_events(ticket_id, created_at);
alter table public.support_ticket_events enable row level security;
drop policy if exists "Ticket participants can read workflow events" on public.support_ticket_events;
create policy "Ticket participants can read workflow events" on public.support_ticket_events for select to authenticated
using (exists (select 1 from public.support_tickets t where t.id = ticket_id));
revoke insert, update, delete on public.support_ticket_events from authenticated, anon;
grant select on public.support_ticket_events to authenticated;

create or replace function public.support_ticket_actor_name(p_actor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(display_name, ''), nullif(username, ''), 'Người dùng')
  from public.user_profiles where user_id = p_actor
$$;

create or replace function public.record_support_ticket_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.support_ticket_events(ticket_id,event_type,status,message,actor_id,actor_name,created_at)
  values(new.id,'submitted',new.status,'Phiếu hỗ trợ đã được gửi',coalesce(new.created_by,(select auth.uid())),
    coalesce(public.support_ticket_actor_name(coalesce(new.created_by,(select auth.uid()))),'Người dùng'),coalesce(new.created_at,now()));
  return new;
end;
$$;
drop trigger if exists support_ticket_submission_event on public.support_tickets;
create trigger support_ticket_submission_event after insert on public.support_tickets
for each row execute function public.record_support_ticket_submission();

create or replace function public.record_support_ticket_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); actor_label text;
begin
  actor_label := coalesce(public.support_ticket_actor_name(actor), 'Nhân sự hỗ trợ');
  if new.status is distinct from old.status then
    insert into public.support_ticket_events(ticket_id,event_type,status,message,actor_id,actor_name,created_at)
    values(new.id,'status_changed',new.status,'',actor,actor_label,clock_timestamp());
  end if;
  if new.assignee_id is distinct from old.assignee_id or new.assignee_name is distinct from old.assignee_name or new.assignee_role is distinct from old.assignee_role then
    insert into public.support_ticket_events(ticket_id,event_type,status,message,actor_id,actor_name,created_at)
    values(new.id,'assigned',new.status,
      case when nullif(trim(new.assignee_name),'') is null then 'Đã cập nhật người phụ trách'
        else 'Đã phân công cho ' || trim(new.assignee_name) || case when nullif(trim(new.assignee_role),'') is null then '' else ' (' || trim(new.assignee_role) || ')' end end,
      actor,actor_label,clock_timestamp());
  end if;
  return new;
end;
$$;
drop trigger if exists support_ticket_progress_event on public.support_tickets;
create trigger support_ticket_progress_event after update of status,assignee_id,assignee_name,assignee_role on public.support_tickets
for each row execute function public.record_support_ticket_progress();

drop policy if exists "Ticket parties and admins can read" on public.support_tickets;
drop policy if exists "Ticket parties and authorized staff can read" on public.support_tickets;
create policy "Ticket parties and authorized staff can read" on public.support_tickets for select to authenticated
using (
  student_user_id = (select auth.uid())
  or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid()))
  or teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
  or public.is_system_admin()
  or (public.current_role_key() = 'assistant' and public.can_access_module('supports','read'))
);
drop policy if exists "Ticket parties and staff can update" on public.support_tickets;
create policy "Ticket parties and staff can update" on public.support_tickets for update to authenticated
using (
  ((teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
    or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or ((student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid()))) and status = 'pending' and public.can_access_module('supports','update'))
)
with check (
  ((teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid())
    or public.is_system_admin() or public.current_role_key() = 'assistant') and public.can_access_module('supports','update'))
  or ((student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = student_record_id and s.auth_user_id = (select auth.uid()))) and status = 'pending' and public.can_access_module('supports','update'))
);
drop policy if exists "Students submit ticket to assigned teacher" on public.support_tickets;
revoke insert on public.support_tickets from authenticated, anon;
grant select, update, delete on public.support_tickets to authenticated;
drop policy if exists "Staff permanently delete trashed tickets" on public.support_tickets;
create policy "Staff permanently delete trashed tickets" on public.support_tickets for delete to authenticated
using (deleted_at is not null and public.can_access_module('supports','delete')
  and (teacher_id = (select auth.uid()) or created_by = (select auth.uid()) or assignee_id = (select auth.uid()) or public.is_system_admin() or public.current_role_key() = 'assistant'));

drop function if exists public.create_support_ticket(text,text,text,text,text,text);
drop function if exists public.create_support_ticket(text,text,text,text,text,text,text);
create or replace function public.create_support_ticket(
  p_title text,
  p_description text,
  p_category text default 'Khác',
  p_priority text default 'normal',
  p_student_code text default null,
  p_location text default null,
  p_room text default null,
  p_student_record_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  caller_role text := public.current_role_key();
  requester uuid;
  requester_record_id uuid;
  assigned_teacher uuid;
  resolved_code text;
  resolved_name text;
  inserted_id uuid;
  staff_creator boolean := false;
begin
  if caller is null then raise exception 'Vui lòng đăng nhập để gửi phiếu hỗ trợ'; end if;
  if nullif(trim(p_title),'') is null or nullif(trim(p_description),'') is null then
    raise exception 'Vui lòng nhập tiêu đề và nội dung yêu cầu';
  end if;
  if p_priority is null or p_priority not in ('low','normal','high','urgent') then raise exception 'Mức độ ưu tiên không hợp lệ'; end if;
  staff_creator := caller_role in ('super_admin','system_admin','sub_admin','teacher','assistant');
  if staff_creator and nullif(trim(p_student_code),'') is not null then
    if not public.can_access_module('supports','create') then raise exception 'Bạn chưa được cấp quyền tạo phiếu hỗ trợ'; end if;
    select s.id, s.auth_user_id, s.student_code, s.full_name
      into requester_record_id, requester, resolved_code, resolved_name
      from public.students s
      where lower(trim(s.student_code)) = lower(trim(p_student_code))
        and (p_student_record_id is null or s.id = p_student_record_id)
        and s.deleted_at is null
      order by s.created_at desc limit 1;
    if requester_record_id is null then raise exception 'Không tìm thấy hồ sơ sinh viên đang hoạt động với mã %', trim(p_student_code); end if;
    assigned_teacher := caller;
  else
    if nullif(trim(p_student_code),'') is not null then raise exception 'Chỉ admin, giảng viên hoặc trợ giảng mới được tạo phiếu theo mã sinh viên'; end if;
    select s.id, s.auth_user_id, s.owner_id, s.student_code, s.full_name
      into requester_record_id, requester, assigned_teacher, resolved_code, resolved_name
      from public.students s
      where s.auth_user_id = caller and s.deleted_at is null
      order by s.created_at desc limit 1;
    if requester is null or assigned_teacher is null then raise exception 'Tài khoản chưa được liên kết với hồ sơ sinh viên và giảng viên phụ trách'; end if;
  end if;
  if assigned_teacher is null or (requester is not null and requester = assigned_teacher) then raise exception 'Không thể gửi phiếu cho chính tài khoản tạo phiếu'; end if;
  if nullif(trim(p_room),'') is null then raise exception 'Vui lòng chọn số phòng'; end if;
  insert into public.support_tickets(student_user_id,student_record_id,teacher_id,created_by,creator_name,student_code,student_name,title,description,category,priority,status,location,room)
  values(requester,requester_record_id,assigned_teacher,caller,public.support_ticket_actor_name(caller),resolved_code,resolved_name,trim(p_title),trim(p_description),coalesce(nullif(trim(p_category),''),'Khác'),p_priority,'pending',nullif(trim(p_location),''),nullif(trim(p_room),''))
  returning id into inserted_id;
  return inserted_id;
end;
$$;
grant execute on function public.create_support_ticket(text,text,text,text,text,text,text,uuid) to authenticated;

create or replace function public.search_support_ticket_students(p_query text)
returns table(student_record_id uuid, student_code text, student_name text, class_name text)
language plpgsql stable security definer set search_path = '' as $$
declare caller_role text := public.current_role_key(); query_text text := trim(coalesce(p_query,''));
begin
  if caller_role not in ('super_admin','system_admin','sub_admin','teacher','assistant') or not public.can_access_module('supports','create') then
    raise exception 'Bạn không có quyền tìm sinh viên để tạo phiếu hỗ trợ';
  end if;
  if length(query_text) < 2 then return; end if;
  return query
    select s.id, s.student_code, s.full_name, coalesce(s.class_name,'')
    from public.students s
    where s.deleted_at is null
      and (s.student_code ilike query_text || '%' or s.full_name ilike '%' || query_text || '%')
    order by case when lower(s.student_code) = lower(query_text) then 0 when s.student_code ilike query_text || '%' then 1 else 2 end,
      s.full_name
    limit 8;
end;
$$;
revoke all on function public.search_support_ticket_students(text) from public, anon;
grant execute on function public.search_support_ticket_students(text) to authenticated;

create or replace function public.update_support_ticket_progress(
  p_ticket_id uuid,
  p_status text,
  p_assignee_id uuid default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  caller_role text := public.current_role_key();
  target public.support_tickets%rowtype;
  actor_label text;
  next_assignee_name text;
  next_assignee_role text;
  next_role_context text;
  next_role_key text;
  next_status text;
begin
  if caller is null then raise exception 'Vui lòng đăng nhập'; end if;
  if caller_role not in ('super_admin','system_admin','sub_admin','teacher','assistant') then raise exception 'Chỉ nhân sự hỗ trợ mới được cập nhật phiếu'; end if;
  if not public.can_access_module('supports','update') then raise exception 'Bạn chưa được cấp quyền cập nhật phiếu hỗ trợ'; end if;
  if p_status is null or p_status not in ('pending','assigned','in_progress','completed') then raise exception 'Trạng thái phiếu không hợp lệ'; end if;
  next_status := case when p_assignee_id is not null and p_status = 'pending' then 'assigned' else p_status end;
  select * into target from public.support_tickets where id = p_ticket_id and deleted_at is null for update;
  if not found then raise exception 'Không tìm thấy phiếu hỗ trợ'; end if;
  if target.status = 'completed' then raise exception 'Phiếu đã hoàn tất và không thể cập nhật tiếp'; end if;
  if next_status = 'assigned' and coalesce(p_assignee_id,target.assignee_id) is null then raise exception 'Cần phân công người phụ trách trước khi chuyển trạng thái'; end if;
  if next_status = 'in_progress' and target.status not in ('assigned','in_progress') then raise exception 'Cần phân công phiếu trước khi bắt đầu xử lý'; end if;
  if next_status = 'in_progress' and coalesce(p_assignee_id,target.assignee_id) is null then raise exception 'Cần có người phụ trách trước khi bắt đầu xử lý'; end if;
  if next_status = 'completed' and target.status <> 'in_progress' then raise exception 'Chỉ có thể hoàn tất phiếu đang được xử lý'; end if;
  if not (public.is_system_admin() or target.teacher_id = caller or target.created_by = caller or target.assignee_id = caller or caller_role = 'assistant') then
    raise exception 'Bạn không phụ trách phiếu hỗ trợ này';
  end if;
  if p_assignee_id is not null then
    select coalesce(nullif(p.display_name,''),nullif(p.username,''),'Nhân sự hỗ trợ'), p.role_key,
      coalesce(nullif(p.job_title,''),nullif(p.department,''))
      into next_assignee_name,next_role_key,next_role_context from public.user_profiles p
      where p.user_id = p_assignee_id and p.role_key in ('super_admin','system_admin','sub_admin','teacher','assistant');
    if next_assignee_name is null then raise exception 'Tài khoản được chọn không phải nhân sự hỗ trợ hợp lệ'; end if;
    next_assignee_role := coalesce(next_role_context,case next_role_key when 'teacher' then 'Giảng viên' when 'assistant' then 'Trợ giảng' else 'Quản trị viên' end);
  end if;
  update public.support_tickets set status = next_status, assignee_id = p_assignee_id,
    assignee_name = next_assignee_name, assignee_role = next_assignee_role where id = p_ticket_id;
  if nullif(trim(p_note),'') is not null then
    actor_label := coalesce(public.support_ticket_actor_name(caller), 'Nhân sự hỗ trợ');
    insert into public.support_ticket_events(ticket_id,event_type,status,message,actor_id,actor_name,created_at)
    values(p_ticket_id,'note',next_status,trim(p_note),caller,actor_label,clock_timestamp());
  end if;
end;
$$;
drop function if exists public.update_support_ticket_progress(uuid,text,text,text,text);
grant execute on function public.update_support_ticket_progress(uuid,text,uuid,text) to authenticated;

create or replace function public.list_support_ticket_assignees()
returns table(user_id uuid, display_name text, role_key text, role_label text)
language plpgsql stable security definer set search_path = '' as $$
declare caller_role text := public.current_role_key();
begin
  if caller_role not in ('super_admin','system_admin','sub_admin','teacher','assistant') or not public.can_access_module('supports','update') then
    raise exception 'Bạn không có quyền xem danh sách người phụ trách';
  end if;
  return query select p.user_id, coalesce(nullif(p.display_name,''),nullif(p.username,''),'Nhân sự hỗ trợ'), p.role_key,
    coalesce(nullif(p.job_title,''),nullif(p.department,''),case p.role_key when 'teacher' then 'Giảng viên' when 'assistant' then 'Trợ giảng' else 'Quản trị viên' end)
    from public.user_profiles p
    where p.role_key in ('super_admin','system_admin','sub_admin','teacher','assistant')
    order by p.display_name,p.username;
end;
$$;
grant execute on function public.list_support_ticket_assignees() to authenticated;

drop function if exists public.set_support_ticket_image(uuid,text);
create or replace function public.set_support_ticket_image(
  p_ticket_id uuid, p_image_path text, p_file_name text, p_content_type text, p_size bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); target public.support_tickets%rowtype; uploader_email text;
begin
  if caller is null then raise exception 'Vui lòng đăng nhập'; end if;
  if p_image_path is null or p_image_path not like (caller::text || '/' || p_ticket_id::text || '/%') then
    raise exception 'Đường dẫn ảnh đính kèm không hợp lệ';
  end if;
  if nullif(trim(p_file_name),'') is null or coalesce(p_content_type,'') not like 'image/%' or p_size is null or p_size <= 0 or p_size > 12582912 then
    raise exception 'Tệp đính kèm phải là hình ảnh có dung lượng tối đa 12 MB';
  end if;
  select * into target from public.support_tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not (target.student_user_id = caller or target.created_by = caller or exists (select 1 from public.students s where s.id = target.student_record_id and s.auth_user_id = caller)) then
    raise exception 'Bạn không có quyền đính kèm ảnh vào phiếu này';
  end if;
  if not (
    (public.current_role_key() in ('student','class_president','class_vice') and (target.student_user_id = caller or exists (select 1 from public.students s where s.id=target.student_record_id and s.auth_user_id=caller)) and public.can_access_module('student-support','create'))
    or (public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and target.created_by=caller and public.can_access_module('supports','create'))
  ) then
    raise exception 'Ticket attachment permission required';
  end if;
  if target.status <> 'pending' or target.image_path is not null then
    raise exception 'Phiếu này không còn nhận ảnh đính kèm';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='vtn-source-files' and name=p_image_path) then
    raise exception 'Không tìm thấy tệp ảnh đã tải lên';
  end if;
  update public.support_tickets set image_path = p_image_path where id = p_ticket_id;
  select coalesce(u.email,'') into uploader_email from auth.users u where u.id = caller;
  insert into public.workspace_records(owner_id,module_key,external_id,data)
  values(caller,'source-data-files','support-ticket-file:' || p_ticket_id::text,
    jsonb_build_object(
      'academicYear','', 'semesterName','', 'fileName',p_file_name, 'storagePath',p_image_path,
      'contentType',p_content_type, 'size',p_size, 'extractedCategories',jsonb_build_object('supports',0)::text,
      'extractedClassifications',jsonb_build_array(jsonb_build_object('categoryKey','supports','academicYear','','semesterName','Tất cả học kỳ','rowCount',0))::text,
      'uploadedAt',now(), 'uploadedBy',uploader_email, 'uploadedById',caller::text, 'supportTicketId',p_ticket_id::text
    ))
  on conflict (owner_id,module_key,external_id) do update set data = excluded.data, updated_at = now();
end;
$$;
grant execute on function public.set_support_ticket_image(uuid,text,text,text,bigint) to authenticated;

insert into public.support_ticket_events(ticket_id,event_type,status,message,actor_id,actor_name,created_at)
select t.id,'submitted',t.status,'Phiếu hỗ trợ đã được gửi',t.created_by,coalesce(public.support_ticket_actor_name(t.created_by),'Người dùng'),t.created_at
from public.support_tickets t
where not exists (select 1 from public.support_ticket_events e where e.ticket_id=t.id);

-- Carry forward requests previously stored by the generic Hỗ trợ sinh viên module.
insert into public.support_tickets(
  student_user_id,student_record_id,teacher_id,created_by,creator_name,student_code,student_name,title,description,
  category,status,location,room,created_at,updated_at,source_workspace_record_id
)
select s.auth_user_id,s.id,
  case when r.owner_id = s.auth_user_id then s.owner_id else r.owner_id end,
  r.owner_id,
  coalesce(public.support_ticket_actor_name(r.owner_id),'Người dùng'),
  s.student_code,s.full_name,
  coalesce(nullif(trim(r.data->>'title'),''),'Yêu cầu hỗ trợ'),
  coalesce(nullif(trim(r.data->>'description'),''),nullif(trim(r.data->>'notes'),''),'Yêu cầu hỗ trợ đã được ghi nhận.'),
  coalesce(nullif(trim(r.data->>'category'),''),'Khác'),
  case when lower(coalesce(r.data->>'status','')) like '%hoàn%' then 'completed'
    when lower(coalesce(r.data->>'status','')) like '%phân công%' then 'assigned'
    when lower(coalesce(r.data->>'status','')) like '%xử lý%' then 'in_progress'
    else 'pending' end,
  nullif(trim(r.data->>'location'),''),nullif(trim(r.data->>'room'),''),r.created_at,r.updated_at,r.id
from public.workspace_records r
join lateral (
  select student.* from public.students student
  where student.deleted_at is null
    and (lower(trim(student.student_code)) = lower(trim(coalesce(r.data->>'studentCode','')))
      or student.auth_user_id = r.owner_id)
  order by case when lower(trim(student.student_code)) = lower(trim(coalesce(r.data->>'studentCode',''))) then 0 else 1 end
  limit 1
) s on true
where r.module_key = 'student-support' and r.deleted_at is null
  and (s.auth_user_id is null or s.auth_user_id <> case when r.owner_id = s.auth_user_id then s.owner_id else r.owner_id end)
  and not exists (select 1 from public.support_tickets old where old.source_workspace_record_id = r.id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vtn-source-files','vtn-source-files',false,52428800,null)
on conflict (id) do nothing;
drop policy if exists "Ticket creators upload their attachments" on storage.objects;
drop policy if exists "Ticket creators upload archived attachments" on storage.objects;
create policy "Ticket creators upload archived attachments" on storage.objects for insert to authenticated
with check (
  bucket_id = 'vtn-source-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and t.image_path is null
        and (
          (t.created_by = (select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('supports','create'))
          or (t.student_user_id = (select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('student-support','create'))
        ))
);
drop policy if exists "Ticket participants read their attachments" on storage.objects;
drop policy if exists "Ticket participants read archived attachments" on storage.objects;
create policy "Ticket participants read archived attachments" on storage.objects for select to authenticated
using (
  bucket_id = 'vtn-source-files'
  and exists (select 1 from public.support_tickets t
    where t.image_path = name
        and (((t.student_user_id = (select auth.uid()) or exists (select 1 from public.students s where s.id = t.student_record_id and s.auth_user_id = (select auth.uid())))
            and public.can_access_module('student-support','read'))
          or ((t.teacher_id = (select auth.uid()) or t.created_by = (select auth.uid()) or t.assignee_id = (select auth.uid()) or public.is_system_admin() or public.current_role_key() = 'assistant')
            and public.can_access_module('supports','read'))))
);
drop policy if exists "Ticket creators remove unattached uploads" on storage.objects;
drop policy if exists "Ticket creators remove unattached archived uploads" on storage.objects;
create policy "Ticket creators remove unattached archived uploads" on storage.objects for delete to authenticated
using (
  bucket_id = 'vtn-source-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and t.image_path is null
        and (
          (t.created_by = (select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('supports','create'))
          or (t.student_user_id = (select auth.uid()) and public.current_role_key() in ('student','class_president','class_vice') and public.can_access_module('student-support','create'))
        ))
);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_ticket_events') then
    alter publication supabase_realtime add table public.support_ticket_events;
  end if;
exception when undefined_object then
  raise notice 'Enable support_ticket_events in Supabase Database publications for live ticket updates.';
end;
$$;

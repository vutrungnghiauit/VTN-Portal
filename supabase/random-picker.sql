-- Run after security.sql and audit.sql.
create table if not exists public.random_picker_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draw_type text not null check (draw_type in ('roll_call','groups','presentation_order','oral_question','study_pairs','case_study','speed_challenge','quick_debate','keyword_draw','true_false','role_assignment')),
  student_id uuid references public.students(id) on delete set null,
  student_code text,
  student_name text,
  class_name text,
  attendance_status text check (attendance_status in ('present','absent')),
  drawn_on date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  results jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.random_picker_history add column if not exists deleted_at timestamptz;
alter table public.random_picker_history add column if not exists purge_at timestamptz;
alter table public.random_picker_history drop constraint if exists random_picker_history_draw_type_check;
alter table public.random_picker_history add constraint random_picker_history_draw_type_check
  check (draw_type in ('roll_call','groups','presentation_order','oral_question','study_pairs','case_study','speed_challenge','quick_debate','keyword_draw','true_false','role_assignment'));
create index if not exists random_picker_history_owner_time_idx on public.random_picker_history(owner_id,created_at desc);
create index if not exists random_picker_history_expiry_idx on public.random_picker_history(drawn_on,class_name,created_at);
drop index if exists public.random_picker_one_call_per_student_daily_idx;
create unique index random_picker_one_call_per_student_daily_idx
  on public.random_picker_history(owner_id,student_id,drawn_on) where draw_type = 'roll_call' and student_id is not null and deleted_at is null;
alter table public.random_picker_history enable row level security;
drop policy if exists "Users read own random history" on public.random_picker_history;
drop policy if exists "Permitted users read random history" on public.random_picker_history;
create policy "Permitted users read random history" on public.random_picker_history for select to authenticated
  using (deleted_at is null and public.can_access_module('random-picker','read') and (
    owner_id = (select auth.uid()) or public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant')
  ));
drop policy if exists "Users create own random history" on public.random_picker_history;
create policy "Users create own random history" on public.random_picker_history for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_access_module('random-picker','create'));
drop policy if exists "Users update own attendance result" on public.random_picker_history;
drop policy if exists "Permitted users update random history" on public.random_picker_history;
create policy "Permitted users update random history" on public.random_picker_history for update to authenticated
  using (public.can_access_module('random-picker','update') and (
    owner_id = (select auth.uid()) or public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant')
  ))
  with check (public.can_access_module('random-picker','update') and (
    owner_id = (select auth.uid()) or public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant')
  ));
drop policy if exists "Permitted users delete random history" on public.random_picker_history;
create policy "Permitted users delete random history" on public.random_picker_history for delete to authenticated
  using (deleted_at is not null and public.can_access_module('random-picker','delete') and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant'));
grant select,insert,update,delete on public.random_picker_history to authenticated;
revoke all on public.random_picker_history from anon;

create or replace function public.protect_random_picker_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then raise exception 'Không thể ghi lịch sử cho tài khoản khác'; end if;
  else
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.draw_type is distinct from old.draw_type
      or new.student_id is distinct from old.student_id or new.student_code is distinct from old.student_code
      or new.student_name is distinct from old.student_name or new.class_name is distinct from old.class_name
      or (new.results - 'note') is distinct from (old.results - 'note') or new.drawn_on is distinct from old.drawn_on
      or new.created_at is distinct from old.created_at then raise exception 'Chỉ được cập nhật điểm danh hoặc ghi chú lịch sử'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists random_picker_history_protection on public.random_picker_history;
create trigger random_picker_history_protection before insert or update on public.random_picker_history
  for each row execute function public.protect_random_picker_history();

create or replace function public.audit_random_picker_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb;
  old_data jsonb;
  history_owner uuid;
  row_id uuid;
  action_name text;
begin
  row_data := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  old_data := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  history_owner := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
  row_id := case when tg_op = 'DELETE' then old.id else new.id end;
  action_name := case when tg_op = 'INSERT' then 'draw' when tg_op = 'DELETE' then 'delete' else 'update' end;
  insert into public.system_audit_logs(actor_id,subject_user_id,module_key,action,source_table,record_id,record_label,details)
  values ((select auth.uid()),history_owner,'random-picker',action_name,'random_picker_history',row_id,
    coalesce(old_data->>'student_name',row_data->>'student_name',old_data->>'draw_type',row_data->>'draw_type','Bản ghi'),
    jsonb_build_object('before',old_data,'after',row_data));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists random_picker_history_audit on public.random_picker_history;
create trigger random_picker_history_audit after insert or update or delete on public.random_picker_history
  for each row execute function public.audit_random_picker_history();

-- Match a saved class and its period range to the session groupings used by the portal.
-- Morning, afternoon and evening records are moved to Trash after their respective shift ends.
create or replace function public.random_picker_session_ended(
  p_class_name text, p_drawn_on date, p_created_at timestamptz, p_now timestamp without time zone
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_records w
    cross join lateral (
      select max(parts[1]::integer) as last_period
      from regexp_matches(coalesce(w.data->>'periods',''), '[0-9]+', 'g') as matched(parts)
    ) periods
    cross join lateral (
      select
        case when coalesce(w.data->>'startDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (w.data->>'startDate')::date end as starts_on,
        case when coalesce(w.data->>'endDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (w.data->>'endDate')::date end as ends_on
    ) bounds
    where w.module_key = 'timetables'
      and w.deleted_at is null
      and nullif(trim(p_class_name),'') is not null
      and lower(trim(p_class_name)) in (
        lower(trim(coalesce(w.data->>'classCode',''))),
        lower(trim(coalesce(w.data->>'className',''))),
        lower(trim(coalesce(w.data->>'expectedClass',''))),
        lower(trim(coalesce(w.data->>'group',''))),
        lower(trim(coalesce(w.data->>'mergedClassCode','')))
      )
      and (bounds.starts_on is null or bounds.starts_on <= p_drawn_on)
      and (bounds.ends_on is null or bounds.ends_on >= p_drawn_on)
      and (
        bounds.starts_on is null
        or nullif(w.data->>'weekNumbers','') is null
        or (',' || regexp_replace(w.data->>'weekNumbers', '[^0-9,]', '', 'g') || ',')
          like '%,' || (((p_drawn_on - bounds.starts_on) / 7) + 1)::text || ',%'
      )
      and case
        when nullif(regexp_replace(coalesce(w.data->>'weekday',''), '[^0-9]', '', 'g'),'')::integer = 8 then 7
        else nullif(regexp_replace(coalesce(w.data->>'weekday',''), '[^0-9]', '', 'g'),'')::integer - 1
      end = extract(isodow from p_drawn_on)::integer
      and periods.last_period is not null
      and case
        when periods.last_period < 7 then p_now::time >= time '12:00' and (p_created_at at time zone 'Asia/Ho_Chi_Minh')::time < time '12:00'
        when periods.last_period < 12 then p_now::time >= time '18:00' and (p_created_at at time zone 'Asia/Ho_Chi_Minh')::time < time '18:00'
        else p_now::time >= time '23:00' and (p_created_at at time zone 'Asia/Ho_Chi_Minh')::time < time '23:00'
      end
  );
$$;

create or replace function public.purge_random_picker_history_after_classes()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.random_picker_history h
    set deleted_at = now()
    where h.deleted_at is null
      and h.class_name is not null
      and public.random_picker_session_ended(
        h.class_name,h.drawn_on,h.created_at,now() at time zone 'Asia/Ho_Chi_Minh'
      );
  get diagnostics affected = row_count;
  return affected;
end;
$$;
do $$
begin
  begin
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'select cron.unschedule(jobid) from cron.job where jobname=''vtn-random-picker-history-purge''';
    execute $schedule$
      select cron.schedule('vtn-random-picker-history-purge','* * * * *','select public.purge_random_picker_history_after_classes()')
    $schedule$;
  exception when others then null;
  end;
end;
$$;
revoke all on function public.random_picker_session_ended(text,date,timestamptz,timestamp without time zone) from public, anon, authenticated;
revoke all on function public.purge_random_picker_history_after_classes() from public, anon, authenticated;

-- The student role can use the picker and mark its own call records only.
update public.role_module_permissions set allowed = true,updated_at = now()
  where role_key in ('student','class_president','class_vice') and module_key = 'random-picker' and action_key in ('read','create','update');

-- Shared topic and question bank for Random interaction tools.
create table if not exists public.random_picker_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  activity_type text not null default 'oral_question' check (activity_type in ('oral_question','case_study','speed_challenge','quick_debate','keyword_draw','true_false','role_assignment')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  deleted_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.random_picker_topics add column if not exists activity_type text not null default 'oral_question';
alter table public.random_picker_topics add column if not exists deleted_at timestamptz;
alter table public.random_picker_topics add column if not exists purge_at timestamptz;
alter table public.random_picker_topics drop constraint if exists random_picker_topics_activity_type_check;
alter table public.random_picker_topics add constraint random_picker_topics_activity_type_check check (activity_type in ('oral_question','case_study','speed_challenge','quick_debate','keyword_draw','true_false','role_assignment'));
drop index if exists public.random_picker_topics_name_unique_idx;
drop index if exists public.random_picker_topics_activity_name_unique_idx;
create unique index random_picker_topics_activity_name_unique_idx on public.random_picker_topics(activity_type,lower(trim(name))) where deleted_at is null;

create table if not exists public.random_picker_questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.random_picker_topics(id) on delete cascade,
  title text not null default '' check (length(trim(title)) <= 160),
  question text not null check (length(trim(question)) between 1 and 4000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  deleted_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.random_picker_questions add column if not exists title text not null default '';
alter table public.random_picker_questions add column if not exists deleted_at timestamptz;
alter table public.random_picker_questions add column if not exists purge_at timestamptz;
drop index if exists public.random_picker_questions_unique_idx;
create unique index random_picker_questions_unique_idx on public.random_picker_questions(topic_id,md5(lower(trim(question)))) where deleted_at is null;
create index if not exists random_picker_questions_topic_idx on public.random_picker_questions(topic_id,created_at);

alter table public.random_picker_topics enable row level security;
alter table public.random_picker_questions enable row level security;
drop policy if exists "Permitted users read random question bank" on public.random_picker_topics;
create policy "Permitted users read random question bank" on public.random_picker_topics for select to authenticated
  using (deleted_at is null and public.can_access_module('random-picker','read'));
drop policy if exists "Permitted staff create random question topics" on public.random_picker_topics;
create policy "Permitted staff create random question topics" on public.random_picker_topics for insert to authenticated
  with check (created_by = (select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','create'));
drop policy if exists "Permitted staff update random question topics" on public.random_picker_topics;
create policy "Permitted staff update random question topics" on public.random_picker_topics for update to authenticated
  using (public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','update'))
  with check (public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','update'));
drop policy if exists "Permitted staff delete random question topics" on public.random_picker_topics;
create policy "Permitted staff delete random question topics" on public.random_picker_topics for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete'));

drop policy if exists "Permitted users read random questions" on public.random_picker_questions;
create policy "Permitted users read random questions" on public.random_picker_questions for select to authenticated
  using (deleted_at is null and exists(select 1 from public.random_picker_topics t where t.id=topic_id and t.deleted_at is null) and public.can_access_module('random-picker','read'));
drop policy if exists "Permitted staff create random questions" on public.random_picker_questions;
create policy "Permitted staff create random questions" on public.random_picker_questions for insert to authenticated
  with check (created_by = (select auth.uid()) and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','create'));
drop policy if exists "Permitted staff update random questions" on public.random_picker_questions;
create policy "Permitted staff update random questions" on public.random_picker_questions for update to authenticated
  using (public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','update'))
  with check (public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','update'));
drop policy if exists "Permitted staff delete random questions" on public.random_picker_questions;
create policy "Permitted staff delete random questions" on public.random_picker_questions for delete to authenticated
  using (deleted_at is not null and public.current_role_key() in ('super_admin','system_admin','sub_admin','teacher','assistant') and public.can_access_module('random-picker','delete'));
grant select,insert,update,delete on public.random_picker_topics,public.random_picker_questions to authenticated;
revoke all on public.random_picker_topics,public.random_picker_questions from anon;

insert into public.role_module_permissions(role_key,module_key,action_key,allowed)
values ('assistant','random-picker','delete',true)
on conflict (role_key,module_key,action_key) do update set allowed=excluded.allowed,updated_at=now();

insert into public.random_picker_topics(name) values ('Kinh tế số'),('Quản trị kinh doanh') on conflict do nothing;
with question_seed(topic_name,question_text) as (values
  ('Kinh tế số',$question$Phân tích tác động của nền tảng số đến chi phí giao dịch và cấu trúc thị trường.$question$),
  ('Kinh tế số',$question$Hiệu ứng mạng lưới là gì? Nêu ví dụ trong một nền tảng tại Việt Nam.$question$),
  ('Kinh tế số',$question$Dữ liệu trở thành tài sản kinh tế như thế nào và cần quản trị ra sao?$question$),
  ('Kinh tế số',$question$So sánh mô hình kinh doanh nền tảng với mô hình kinh doanh truyền thống.$question$),
  ('Kinh tế số',$question$Phân tích cơ hội và rủi ro của trí tuệ nhân tạo đối với năng suất lao động.$question$),
  ('Kinh tế số',$question$Thương mại điện tử xuyên biên giới tạo ra những thách thức nào cho doanh nghiệp nhỏ?$question$),
  ('Kinh tế số',$question$Giải thích khái niệm kinh tế chia sẻ và đánh giá một ví dụ thực tế.$question$),
  ('Kinh tế số',$question$Doanh nghiệp cần những năng lực số nào để chuyển đổi số thành công?$question$),
  ('Kinh tế số',$question$Phân tích vai trò của thanh toán số trong tài chính toàn diện.$question$),
  ('Kinh tế số',$question$Quyền riêng tư dữ liệu ảnh hưởng thế nào đến niềm tin và tăng trưởng nền tảng?$question$),
  ('Quản trị kinh doanh',$question$Phân tích cách doanh nghiệp xây dựng lợi thế cạnh tranh bền vững.$question$),
  ('Quản trị kinh doanh',$question$So sánh lãnh đạo chuyển đổi và lãnh đạo giao dịch; khi nào nên áp dụng?$question$),
  ('Quản trị kinh doanh',$question$Trình bày các bước xây dựng kế hoạch marketing cho sản phẩm mới.$question$),
  ('Quản trị kinh doanh',$question$Phân tích cách quản trị rủi ro trong quyết định mở rộng thị trường.$question$),
  ('Quản trị kinh doanh',$question$Văn hóa tổ chức tác động thế nào đến hiệu quả đổi mới sáng tạo?$question$),
  ('Quản trị kinh doanh',$question$Đề xuất chỉ số KPI phù hợp để đánh giá hiệu quả một nhóm dự án.$question$),
  ('Quản trị kinh doanh',$question$Phân biệt chiến lược cấp công ty và chiến lược cấp đơn vị kinh doanh.$question$),
  ('Quản trị kinh doanh',$question$Doanh nghiệp nên xử lý xung đột lợi ích giữa tăng trưởng và trách nhiệm xã hội thế nào?$question$),
  ('Quản trị kinh doanh',$question$Phân tích vai trò của trải nghiệm khách hàng trong giữ chân khách hàng.$question$),
  ('Quản trị kinh doanh',$question$Một doanh nghiệp nhỏ có ngân sách hạn chế nên ưu tiên nguồn lực theo nguyên tắc nào?$question$)
)
insert into public.random_picker_questions(topic_id,question)
select topic.id,seed.question_text from question_seed seed join public.random_picker_topics topic on topic.name=seed.topic_name and topic.activity_type='oral_question'
on conflict do nothing;

insert into public.random_picker_topics(activity_type,name) values
  ('case_study','Thảo luận tình huống'),
  ('speed_challenge','Thử thách 60 giây'),
  ('quick_debate','Tranh biện nhanh')
on conflict do nothing;

with interaction_seed(activity_type,topic_name,title,question_text) as (values
  ('case_study','Thảo luận tình huống','Khách hàng rời bỏ nền tảng',$question$Một ứng dụng giao đồ ăn tăng phí dịch vụ và lượng khách quay lại giảm mạnh. Hãy xác định hai nguyên nhân có thể xảy ra, đề xuất một giải pháp trong tháng tới và chọn chỉ số để đánh giá.$question$),
  ('case_study','Thảo luận tình huống','Sự cố lộ dữ liệu',$question$Một cửa hàng trực tuyến phát hiện thông tin liên hệ của khách hàng bị chia sẻ nhầm. Hãy nêu ba việc cần làm ngay, cách thông báo với khách hàng và một biện pháp ngăn sự cố lặp lại.$question$),
  ('case_study','Thảo luận tình huống','Ra mắt sản phẩm với ngân sách nhỏ',$question$Một nhóm khởi nghiệp có ngân sách marketing hạn chế nhưng cần tìm 100 khách hàng đầu tiên. Hãy chọn nhóm khách hàng mục tiêu, một kênh tiếp cận và cách kiểm tra hiệu quả.$question$),
  ('case_study','Thảo luận tình huống','Nhóm dự án trễ tiến độ',$question$Dự án còn hai tuần nhưng một hạng mục quan trọng đang chậm và các thành viên chưa thống nhất ưu tiên. Hãy đề xuất cách chia lại công việc và một nguyên tắc phối hợp để hoàn thành đúng hạn.$question$),
  ('case_study','Thảo luận tình huống','Đánh giá chương trình khuyến mãi',$question$Doanh số tăng trong thời gian giảm giá nhưng lợi nhuận giảm và khách hàng ít quay lại sau đó. Hãy nêu dữ liệu cần xem và đề xuất cách điều chỉnh chương trình.$question$),
  ('speed_challenge','Thử thách 60 giây','Một câu giới thiệu',$question$Trong 60 giây, hãy giới thiệu một ý tưởng kinh doanh bằng đúng một câu nêu rõ khách hàng, nhu cầu và giá trị mang lại.$question$),
  ('speed_challenge','Thử thách 60 giây','Ba cách kiểm chứng',$question$Trong 60 giây, hãy nêu ba cách ít tốn chi phí để kiểm chứng xem khách hàng có thật sự cần một sản phẩm mới hay không.$question$),
  ('speed_challenge','Thử thách 60 giây','Chỉ số trọng tâm',$question$Trong 60 giây, hãy chọn một chỉ số quan trọng nhất để đánh giá một nền tảng học trực tuyến và giải thích ngắn gọn lý do.$question$),
  ('speed_challenge','Thử thách 60 giây','Lập luận bằng dữ liệu',$question$Trong 60 giây, hãy đưa ra một lập luận và nêu dữ liệu cần thu thập để thuyết phục nhóm thử nghiệm một thay đổi nhỏ trong sản phẩm.$question$),
  ('speed_challenge','Thử thách 60 giây','Tái sử dụng nguồn lực',$question$Trong 60 giây, hãy nêu một cách biến nguồn lực sẵn có của doanh nghiệp thành giá trị mới cho khách hàng.$question$),
  ('quick_debate','Tranh biện nhanh','Làm việc từ xa',$question$Doanh nghiệp nên cho nhân viên làm việc từ xa phần lớn thời gian. Lập trường cần bảo vệ:$question$),
  ('quick_debate','Tranh biện nhanh','Trí tuệ nhân tạo trong học tập',$question$Sinh viên nên được dùng công cụ trí tuệ nhân tạo trong mọi bài tập nếu có trích dẫn. Lập trường cần bảo vệ:$question$),
  ('quick_debate','Tranh biện nhanh','Giảm giá để tăng trưởng',$question$Giảm giá thường xuyên là cách tốt nhất để một doanh nghiệp mới tăng trưởng nhanh. Lập trường cần bảo vệ:$question$),
  ('quick_debate','Tranh biện nhanh','Dữ liệu cá nhân',$question$Khách hàng nên nhận được ưu đãi khi đồng ý chia sẻ dữ liệu cá nhân cho doanh nghiệp. Lập trường cần bảo vệ:$question$),
  ('quick_debate','Tranh biện nhanh','Họp nhóm',$question$Các nhóm dự án nên thay phần lớn cuộc họp bằng cập nhật tiến độ bằng văn bản. Lập trường cần bảo vệ:$question$)
)
insert into public.random_picker_questions(topic_id,title,question)
select topic.id,seed.title,seed.question_text
from interaction_seed seed
join public.random_picker_topics topic on topic.activity_type=seed.activity_type and topic.name=seed.topic_name
on conflict do nothing;

insert into public.random_picker_topics(activity_type,name) values
  ('keyword_draw','Từ khóa kinh tế và quản trị'),
  ('true_false','Đúng hay Sai'),
  ('role_assignment','Vai trò thảo luận')
on conflict do nothing;

with interaction_seed(activity_type,topic_name,title,question_text) as (values
  ('keyword_draw','Từ khóa kinh tế và quản trị','Chi phí cơ hội',$question$Giải thích khái niệm bằng lời của bạn và nêu một ví dụ trong quyết định kinh doanh.$question$),
  ('keyword_draw','Từ khóa kinh tế và quản trị','Lợi thế cạnh tranh',$question$Nêu một nguồn tạo lợi thế cạnh tranh và cách doanh nghiệp duy trì lợi thế đó.$question$),
  ('keyword_draw','Từ khóa kinh tế và quản trị','Phân khúc khách hàng',$question$Mô tả một cách phân khúc khách hàng và đưa ra ví dụ phù hợp.$question$),
  ('keyword_draw','Từ khóa kinh tế và quản trị','Hiệu ứng mạng lưới',$question$Giải thích vì sao một nền tảng có thể có giá trị hơn khi có thêm người dùng.$question$),
  ('keyword_draw','Từ khóa kinh tế và quản trị','Dòng tiền',$question$Phân biệt dòng tiền với lợi nhuận và nêu một lý do doanh nghiệp cần theo dõi cả hai.$question$),
  ('true_false','Đúng hay Sai','Doanh thu tăng luôn đồng nghĩa lợi nhuận tăng.',$question$Sai. Chi phí có thể tăng nhanh hơn doanh thu nên lợi nhuận vẫn giảm.$question$),
  ('true_false','Đúng hay Sai','Tỷ lệ chuyển đổi bằng số người thực hiện hành động chia cho số người được tiếp cận.',$question$Đúng. Cần xác định rõ hành động mục tiêu và cùng một khoảng thời gian đo lường.$question$),
  ('true_false','Đúng hay Sai','Khảo sát khách hàng là cách duy nhất để kiểm chứng một ý tưởng kinh doanh.',$question$Sai. Có thể kiểm chứng bằng phỏng vấn, thử nghiệm nguyên mẫu, dữ liệu hành vi hoặc bán thử.$question$),
  ('true_false','Đúng hay Sai','Thông tin cá nhân công khai có thể được doanh nghiệp tùy ý sử dụng.',$question$Sai. Việc sử dụng vẫn cần có mục đích và căn cứ phù hợp, đồng thời tôn trọng quyền riêng tư.$question$),
  ('role_assignment','Vai trò thảo luận','Điều phối viên',$question$Giữ cuộc thảo luận đúng trọng tâm, phân bổ lượt nói và mời mọi thành viên tham gia.$question$),
  ('role_assignment','Vai trò thảo luận','Người phân tích',$question$Phân tích dữ kiện, xác định nguyên nhân và làm rõ các giả định của nhóm.$question$),
  ('role_assignment','Vai trò thảo luận','Người phản biện',$question$Kiểm tra lập luận, nêu rủi ro và đề xuất góc nhìn khác.$question$),
  ('role_assignment','Vai trò thảo luận','Thư ký',$question$Ghi lại ý chính, quyết định và các việc nhóm cần thực hiện tiếp theo.$question$),
  ('role_assignment','Vai trò thảo luận','Báo cáo viên',$question$Tổng hợp và trình bày kết quả thảo luận ngắn gọn, rõ ràng.$question$),
  ('role_assignment','Vai trò thảo luận','Quản lý thời gian',$question$Theo dõi thời lượng và nhắc nhóm hoàn thành từng phần đúng hạn.$question$)
)
insert into public.random_picker_questions(topic_id,title,question)
select topic.id,seed.title,seed.question_text
from interaction_seed seed
join public.random_picker_topics topic on topic.activity_type=seed.activity_type and topic.name=seed.topic_name
on conflict do nothing;

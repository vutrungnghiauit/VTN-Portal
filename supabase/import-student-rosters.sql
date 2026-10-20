-- Run in Supabase SQL Editor after students.sql and security.sql.
-- Each source enrollment row is kept as its own student-module record, even if
-- several rows share an MSSV. Re-importing the same source row updates that row.
alter table public.students add column if not exists source_registration_key text;

drop index if exists public.students_owner_student_code_unique;
create unique index if not exists students_owner_student_code_unique
  on public.students (owner_id, lower(student_code)) where source_registration_key is null;
create unique index if not exists students_owner_source_registration_unique
  on public.students (owner_id, lower(student_code), source_registration_key)
  where source_registration_key is not null;

create or replace function public.import_student_roster(p_students jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  item record;
  was_inserted boolean;
  inserted_count integer := 0;
  updated_count integer := 0;
  processed integer := 0;
begin
  if caller_id is null then raise exception 'Cần đăng nhập để nhập danh sách sinh viên'; end if;
  if not public.can_access_module('students', 'create') or not public.can_access_module('students', 'update') then
    raise exception 'Bạn cần quyền thêm và cập nhật hồ sơ sinh viên để nhập hoặc chạy lại danh sách';
  end if;
  if jsonb_typeof(p_students) <> 'array' or jsonb_array_length(p_students) = 0 then
    raise exception 'Danh sách nhập phải có ít nhất 1 hồ sơ';
  end if;

  for item in
    select * from jsonb_to_recordset(p_students) as r(
      "studentCode" text, "fullName" text, "dateOfBirth" date, "className" text, faculty text,
      "semesterName" text, "academicStatus" text, email text, phone text, notes text, "sourceRegistrationKey" text
    )
  loop
    if nullif(btrim(item."studentCode"), '') is null or nullif(btrim(item."fullName"), '') is null then
      raise exception 'Mỗi hồ sơ cần có mã sinh viên và họ tên';
    end if;
    if exists (
      select 1 from public.students s
      where s.owner_id = caller_id and lower(s.student_code) = lower(btrim(item."studentCode"))
        and s.source_registration_key = item."sourceRegistrationKey" and s.deleted_at is not null
    ) then
      raise exception 'MSSV % đang nằm trong thùng rác. Hãy khôi phục hồ sơ trước khi nhập lại', item."studentCode";
    end if;

    insert into public.students (
      owner_id, student_code, full_name, date_of_birth, class_name, faculty,
      semester_name, academic_status, email, phone, notes, source_registration_key, updated_at
    ) values (
      caller_id, btrim(item."studentCode"), btrim(item."fullName"), item."dateOfBirth",
      nullif(btrim(item."className"), ''), nullif(btrim(item.faculty), ''),
      nullif(btrim(item."semesterName"), ''), coalesce(nullif(btrim(item."academicStatus"), ''), 'Đang học'),
      nullif(btrim(item.email), ''), nullif(btrim(item.phone), ''), nullif(item.notes, ''), item."sourceRegistrationKey", now()
    )
    on conflict (owner_id, (lower(student_code)), source_registration_key)
      where source_registration_key is not null do update set
      full_name = excluded.full_name,
      date_of_birth = coalesce(excluded.date_of_birth, public.students.date_of_birth),
      class_name = coalesce(excluded.class_name, public.students.class_name),
      faculty = coalesce(excluded.faculty, public.students.faculty),
      semester_name = coalesce(excluded.semester_name, public.students.semester_name),
      academic_status = excluded.academic_status,
      email = coalesce(excluded.email, public.students.email),
      phone = coalesce(excluded.phone, public.students.phone),
      notes = excluded.notes,
      source_registration_key = excluded.source_registration_key,
      updated_at = now()
    returning (xmax = 0) into was_inserted;

    if was_inserted then inserted_count := inserted_count + 1; else updated_count := updated_count + 1; end if;
    processed := processed + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'updated', updated_count, 'processed', processed);
end;
$$;

revoke all on function public.import_student_roster(jsonb) from public, anon;
grant execute on function public.import_student_roster(jsonb) to authenticated;

-- Run after security.sql, workspace.sql and system-settings.sql.
create or replace function public.set_current_semester(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare chosen text := nullif(trim(p_name),''); caller uuid := (select auth.uid());
begin
  if caller is null or not (public.is_system_admin() or public.can_access_module('semesters','update') or public.can_access_module('settings','update')) then
    raise exception 'Không có quyền chọn học kỳ hiện hành';
  end if;
  update public.system_settings set data=jsonb_set(data,'{current_semester}',to_jsonb(coalesce(chosen,'')),true),updated_by=caller,updated_at=now() where id=true;
  update public.workspace_records set data=jsonb_set(data,'{current}',to_jsonb(case when chosen is not null and data->>'title'=chosen then 'Có' else 'Không' end),true)
   where module_key='semesters' and deleted_at is null;
end;
$$;
grant execute on function public.set_current_semester(text) to authenticated;

create or replace function public.enforce_semester_week_limit()
returns trigger language plpgsql set search_path = '' as $$
declare weeks_value numeric;
begin
  if new.module_key='semesters' then
    begin weeks_value := nullif(new.data->>'weeks','')::numeric;
    exception when others then raise exception 'Số tuần học phải là số hợp lệ'; end;
    if weeks_value is not null and (weeks_value < 1 or weeks_value > 60) then
      raise exception 'Thời lượng học kỳ phải từ 1 đến tối đa 60 tuần';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists semester_week_limit on public.workspace_records;
create trigger semester_week_limit before insert or update of module_key,data on public.workspace_records for each row execute function public.enforce_semester_week_limit();

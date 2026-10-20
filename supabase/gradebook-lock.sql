-- Apply after security.sql and workspace.sql.
-- A locked grade cannot be edited, trashed, or permanently deleted until it is unlocked.
create or replace function public.guard_locked_grade_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.module_key = 'grades' and old.data->>'locked' = 'true' then
      raise exception 'Điểm đã khóa. Hãy mở khóa trước khi xóa.';
    end if;
    return old;
  end if;

  if old.module_key = 'grades' and old.data->>'locked' = 'true' then
    if new.module_key is distinct from old.module_key
      or new.owner_id is distinct from old.owner_id
      or new.data->>'locked' is distinct from 'false'
      or new.deleted_at is distinct from old.deleted_at
      or (new.data - 'locked' - 'lockedAt') is distinct from (old.data - 'locked' - 'lockedAt') then
      raise exception 'Điểm đã khóa. Hãy mở khóa trước khi thay đổi.';
    end if;
    if not public.can_access_module('grades', 'update') then
      raise exception 'Bạn không có quyền mở khóa điểm.';
    end if;
  elsif old.module_key = 'grades'
    and old.data->>'locked' is distinct from new.data->>'locked'
    and not public.can_access_module('grades', 'update') then
    raise exception 'Bạn không có quyền khóa điểm.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_grade_lock_guard on public.workspace_records;
create trigger workspace_grade_lock_guard
before update or delete on public.workspace_records
for each row execute function public.guard_locked_grade_record();

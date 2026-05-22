alter table public.employees
  add column if not exists first_name text,
  add column if not exists last_name text;

create or replace function public.sync_employee_name_columns()
returns trigger
language plpgsql
as $$
declare
  should_parse_full_name boolean := false;
begin
  if new.full_name is not null then
    should_parse_full_name := TG_OP = 'INSERT'
      or new.first_name is null
      or new.last_name is null;

    if TG_OP = 'UPDATE' and new.full_name is distinct from old.full_name then
      should_parse_full_name := true;
    end if;
  end if;

  if should_parse_full_name then
    new.first_name = case
      when position(',' in new.full_name) > 0
        then btrim(substring(new.full_name from position(',' in new.full_name) + 1))
      when array_length(regexp_split_to_array(btrim(new.full_name), '\s+'), 1) > 1
        then regexp_replace(btrim(new.full_name), '\s+\S+$', '')
      else btrim(new.full_name)
    end;

    new.last_name = case
      when position(',' in new.full_name) > 0
        then btrim(split_part(new.full_name, ',', 1))
      when array_length(regexp_split_to_array(btrim(new.full_name), '\s+'), 1) > 1
        then regexp_replace(btrim(new.full_name), '^.*\s+', '')
      else ''
    end;
  end if;

  new.first_name = coalesce(new.first_name, '');
  new.last_name = coalesce(new.last_name, '');

  new.full_name = case
    when btrim(new.first_name) <> '' and btrim(new.last_name) <> ''
      then btrim(new.last_name) || ', ' || btrim(new.first_name)
    else coalesce(nullif(btrim(new.last_name), ''), nullif(btrim(new.first_name), ''), new.full_name)
  end;

  return new;
end;
$$;

update public.employees
set
  first_name = case
    when position(',' in full_name) > 0
      then btrim(substring(full_name from position(',' in full_name) + 1))
    when array_length(regexp_split_to_array(btrim(full_name), '\s+'), 1) > 1
      then regexp_replace(btrim(full_name), '\s+\S+$', '')
    else btrim(full_name)
  end,
  last_name = case
    when position(',' in full_name) > 0
      then btrim(split_part(full_name, ',', 1))
    when array_length(regexp_split_to_array(btrim(full_name), '\s+'), 1) > 1
      then regexp_replace(btrim(full_name), '^.*\s+', '')
    else ''
  end
where first_name is null
  or last_name is null;

alter table public.employees
  alter column first_name set not null,
  alter column last_name set not null;

drop trigger if exists employees_sync_name_columns on public.employees;

create trigger employees_sync_name_columns
before insert or update of first_name, last_name, full_name on public.employees
for each row
execute function public.sync_employee_name_columns();

drop index if exists public.employees_business_area_idx;

create index if not exists employees_business_area_idx
on public.employees (business_area_id, schedule_id, last_name, first_name);

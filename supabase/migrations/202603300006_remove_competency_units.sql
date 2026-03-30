do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'competencies'
      and column_name = 'unit_id'
  ) then
    alter table competencies drop constraint if exists competencies_unit_id_fkey;
    drop index if exists competencies_unit_code_idx;
    alter table competencies drop constraint if exists competencies_unit_id_code_key;
    alter table competencies drop constraint if exists competencies_unit_code_key;
    alter table competencies add constraint competencies_code_key unique (code);
    alter table competencies drop column unit_id;
  end if;
end
$$;

create index if not exists competencies_code_idx on competencies (code);

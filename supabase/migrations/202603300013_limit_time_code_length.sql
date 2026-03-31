do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_codes_code_length_check'
  ) then
    alter table time_codes
      add constraint time_codes_code_length_check
      check (char_length(code) <= 5);
  end if;
end
$$;

update time_codes
set
  code = case
    when code in ('DAY', 'DAYS') then 'DAY'
    when code in ('NIGHT', 'NIGHTS') then 'NIGHT'
    else code
  end,
  label = case
    when code in ('DAY', 'DAYS') then 'Day shift'
    when code in ('NIGHT', 'NIGHTS') then 'Night shift'
    else label
  end;

alter table time_codes
drop column if exists category;

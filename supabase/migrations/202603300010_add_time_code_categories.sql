alter table time_codes
add column if not exists category text not null default 'General';

update time_codes
set category = case code
  when 'ILL' then 'Absence'
  when 'ABSA' then 'Absence'
  when 'BOT' then 'Leave'
  when 'V' then 'Leave'
  when 'SIM' then 'Training'
  when 'DAYS' then 'Coverage'
  when 'NIGHTS' then 'Coverage'
  else category
end
where category = 'General';

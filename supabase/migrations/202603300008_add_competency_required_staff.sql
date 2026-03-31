alter table competencies
add column if not exists required_staff integer not null default 1;

update competencies
set required_staff = case id
  when 'comp-post-1' then 2
  when 'comp-post-11' then 2
  when 'comp-post-12' then 2
  when 'comp-post-21' then 1
  when 'comp-dock-2' then 2
  when 'comp-dock-7' then 1
  when 'comp-dock-9' then 1
  when 'comp-pack-3' then 2
  when 'comp-pack-6' then 2
  when 'comp-pack-9' then 1
  else required_staff
end;

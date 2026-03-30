insert into production_units (id, name, description)
values
  ('unit-casting', 'Casting Hall', 'High-throughput production line with rotating post coverage.'),
  ('unit-dispatch', 'Dispatch Yard', 'Outbound flow with dock, scale, and release coverage.'),
  ('unit-packaging', 'Packaging Floor', 'Pack-out, palletizing, and final QA staging.')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description;

insert into schedules (id, unit_id, name, start_date, day_shift_days, night_shift_days, off_days)
values
  ('schedule-casting-601', 'unit-casting', 'Casting 601', '2026-01-01', 3, 3, 6),
  ('schedule-casting-602', 'unit-casting', 'Casting 602', '2026-01-04', 3, 3, 6),
  ('schedule-dispatch-601', 'unit-dispatch', 'Dispatch 601', '2026-01-01', 3, 3, 6),
  ('schedule-packaging-603', 'unit-packaging', 'Packaging 603', '2026-01-07', 3, 3, 6)
on conflict (id) do update
set
  unit_id = excluded.unit_id,
  name = excluded.name,
  start_date = excluded.start_date,
  day_shift_days = excluded.day_shift_days,
  night_shift_days = excluded.night_shift_days,
  off_days = excluded.off_days;

insert into competencies (id, unit_id, code, label, color_token)
values
  ('comp-post-1', 'unit-casting', 'Post 1', 'Furnace feed', 'amber'),
  ('comp-post-11', 'unit-casting', 'Post 11', 'Mold prep', 'teal'),
  ('comp-post-12', 'unit-casting', 'Post 12', 'Pour line', 'violet'),
  ('comp-post-21', 'unit-casting', 'Post 21', 'Quality bay', 'rose'),
  ('comp-dock-2', 'unit-dispatch', 'Dock 2', 'Scale + manifest', 'blue'),
  ('comp-dock-7', 'unit-dispatch', 'Dock 7', 'Release gate', 'lime'),
  ('comp-dock-9', 'unit-dispatch', 'Dock 9', 'Outbound staging', 'orange')
on conflict (id) do update
set
  unit_id = excluded.unit_id,
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token;

insert into employees (id, schedule_id, full_name, role_title)
values
  ('emp-ava', 'schedule-casting-601', 'Ava Patel', 'Senior Operator'),
  ('emp-noah', 'schedule-casting-602', 'Noah Kim', 'Relief Operator'),
  ('emp-jules', 'schedule-casting-601', 'Jules Martin', 'Coordinator'),
  ('emp-mika', 'schedule-casting-602', 'Mika Stone', 'Operator'),
  ('emp-siena', 'schedule-casting-601', 'Siena Morales', 'Team Lead'),
  ('emp-owen', 'schedule-casting-602', 'Owen Clarke', 'Operator'),
  ('emp-cam', 'schedule-dispatch-601', 'Cam Russell', 'Dispatch Lead'),
  ('emp-lena', 'schedule-dispatch-601', 'Lena Abbas', 'Yard Specialist'),
  ('emp-maia', 'schedule-packaging-603', 'Maia Chen', 'QA Tech'),
  ('emp-gia', 'schedule-packaging-603', 'Gia Turner', 'Packaging Tech')
on conflict (id) do update
set
  schedule_id = excluded.schedule_id,
  full_name = excluded.full_name,
  role_title = excluded.role_title;

insert into employee_competencies (employee_id, competency_id)
values
  ('emp-ava', 'comp-post-1'),
  ('emp-ava', 'comp-post-11'),
  ('emp-ava', 'comp-post-12'),
  ('emp-noah', 'comp-post-11'),
  ('emp-noah', 'comp-post-21'),
  ('emp-jules', 'comp-post-12'),
  ('emp-jules', 'comp-post-21'),
  ('emp-mika', 'comp-post-1'),
  ('emp-mika', 'comp-post-12'),
  ('emp-siena', 'comp-post-1'),
  ('emp-siena', 'comp-post-21'),
  ('emp-owen', 'comp-post-11'),
  ('emp-owen', 'comp-post-12'),
  ('emp-cam', 'comp-dock-2'),
  ('emp-cam', 'comp-dock-7'),
  ('emp-lena', 'comp-dock-7'),
  ('emp-lena', 'comp-dock-9'),
  ('emp-maia', 'comp-pack-6'),
  ('emp-maia', 'comp-pack-9'),
  ('emp-gia', 'comp-pack-3'),
  ('emp-gia', 'comp-pack-6'),
  ('emp-gia', 'comp-pack-9')
on conflict (employee_id, competency_id) do nothing;

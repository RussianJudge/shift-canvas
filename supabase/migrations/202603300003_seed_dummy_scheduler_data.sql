insert into production_units (id, name, description)
values
  ('unit-casting', 'Casting Hall', 'High-throughput production line with rotating post coverage.'),
  ('unit-dispatch', 'Dispatch Yard', 'Outbound flow with dock, scale, and release coverage.'),
  ('unit-packaging', 'Packaging Floor', 'Pack-out, palletizing, and final QA staging.')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description;

insert into schedules (id, name, start_date, day_shift_days, night_shift_days, off_days)
values
  ('schedule-601', '601', '2026-01-01', 3, 3, 6),
  ('schedule-602', '602', '2026-01-04', 3, 3, 6),
  ('schedule-603', '603', '2026-01-07', 3, 3, 6),
  ('schedule-604', '604', '2026-01-10', 3, 3, 6)
on conflict (id) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  day_shift_days = excluded.day_shift_days,
  night_shift_days = excluded.night_shift_days,
  off_days = excluded.off_days;

insert into competencies (id, code, label, color_token, required_staff)
values
  ('comp-post-1', 'Post 1', 'Furnace feed', 'amber', 2),
  ('comp-post-11', 'Post 11', 'Mold prep', 'teal', 2),
  ('comp-post-12', 'Post 12', 'Pour line', 'violet', 2),
  ('comp-post-21', 'Post 21', 'Quality bay', 'rose', 1),
  ('comp-dock-2', 'Dock 2', 'Scale + manifest', 'blue', 2),
  ('comp-dock-7', 'Dock 7', 'Release gate', 'lime', 1),
  ('comp-dock-9', 'Dock 9', 'Outbound staging', 'orange', 1),
  ('comp-pack-3', 'Pack 3', 'Case pack line', 'teal', 2),
  ('comp-pack-6', 'Pack 6', 'Palletizing', 'blue', 2),
  ('comp-pack-9', 'Pack 9', 'Final QA hold', 'rose', 1)
on conflict (id) do update
set
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token,
  required_staff = excluded.required_staff;

insert into time_codes (id, code, label, color_token)
values
  ('time-ill', 'ILL', 'Illness', 'rose'),
  ('time-absa', 'ABSA', 'Absent', 'orange'),
  ('time-bot', 'BOT', 'Booked off', 'amber'),
  ('time-days', 'DAY', 'Day shift', 'blue'),
  ('time-nights', 'NIGHT', 'Night shift', 'violet'),
  ('time-sim', 'SIM', 'Simulation', 'teal'),
  ('time-v', 'V', 'Vacation', 'lime')
on conflict (id) do update
set
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token;

insert into employees (id, schedule_id, unit_id, full_name, role_title)
values
  ('emp-ava', 'schedule-601', 'unit-casting', 'Ava Patel', 'Senior Operator'),
  ('emp-noah', 'schedule-602', 'unit-casting', 'Noah Kim', 'Relief Operator'),
  ('emp-jules', 'schedule-603', 'unit-casting', 'Jules Martin', 'Coordinator'),
  ('emp-mika', 'schedule-604', 'unit-casting', 'Mika Stone', 'Operator'),
  ('emp-siena', 'schedule-601', 'unit-casting', 'Siena Morales', 'Team Lead'),
  ('emp-owen', 'schedule-602', 'unit-casting', 'Owen Clarke', 'Operator'),
  ('emp-rina', 'schedule-603', 'unit-casting', 'Rina Das', 'Utility Relief'),
  ('emp-teo', 'schedule-604', 'unit-casting', 'Teo Ramirez', 'Operator'),
  ('emp-cam', 'schedule-601', 'unit-dispatch', 'Cam Russell', 'Dispatch Lead'),
  ('emp-lena', 'schedule-602', 'unit-dispatch', 'Lena Abbas', 'Yard Specialist'),
  ('emp-eli', 'schedule-603', 'unit-dispatch', 'Eli Foster', 'Coordinator'),
  ('emp-zara', 'schedule-604', 'unit-dispatch', 'Zara Shah', 'Relief Operator'),
  ('emp-nina', 'schedule-601', 'unit-dispatch', 'Nina Brooks', 'Yard Controller'),
  ('emp-hugo', 'schedule-602', 'unit-dispatch', 'Hugo Tran', 'Manifest Clerk'),
  ('emp-iris', 'schedule-603', 'unit-dispatch', 'Iris Bennett', 'Dispatch Operator'),
  ('emp-omar', 'schedule-604', 'unit-dispatch', 'Omar Vega', 'Release Specialist'),
  ('emp-kira', 'schedule-601', 'unit-packaging', 'Kira Walsh', 'Packaging Lead'),
  ('emp-joel', 'schedule-602', 'unit-packaging', 'Joel Park', 'Case Packer'),
  ('emp-maia', 'schedule-603', 'unit-packaging', 'Maia Chen', 'QA Tech'),
  ('emp-rhett', 'schedule-604', 'unit-packaging', 'Rhett Cole', 'Forklift Operator'),
  ('emp-dina', 'schedule-601', 'unit-packaging', 'Dina Scott', 'Line Operator'),
  ('emp-finn', 'schedule-602', 'unit-packaging', 'Finn Alvarez', 'Palletizer'),
  ('emp-gia', 'schedule-603', 'unit-packaging', 'Gia Turner', 'Packaging Tech'),
  ('emp-leo', 'schedule-604', 'unit-packaging', 'Leo Morris', 'Inventory Relief')
on conflict (id) do update
set
  schedule_id = excluded.schedule_id,
  unit_id = excluded.unit_id,
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
  ('emp-rina', 'comp-post-11'),
  ('emp-rina', 'comp-post-12'),
  ('emp-rina', 'comp-post-21'),
  ('emp-teo', 'comp-post-1'),
  ('emp-teo', 'comp-post-12'),
  ('emp-cam', 'comp-dock-2'),
  ('emp-cam', 'comp-dock-7'),
  ('emp-lena', 'comp-dock-7'),
  ('emp-lena', 'comp-dock-9'),
  ('emp-eli', 'comp-dock-2'),
  ('emp-eli', 'comp-dock-9'),
  ('emp-zara', 'comp-dock-2'),
  ('emp-zara', 'comp-dock-7'),
  ('emp-zara', 'comp-dock-9'),
  ('emp-nina', 'comp-dock-2'),
  ('emp-nina', 'comp-dock-7'),
  ('emp-hugo', 'comp-dock-2'),
  ('emp-hugo', 'comp-dock-9'),
  ('emp-iris', 'comp-dock-7'),
  ('emp-iris', 'comp-dock-9'),
  ('emp-omar', 'comp-dock-2'),
  ('emp-omar', 'comp-dock-7'),
  ('emp-kira', 'comp-pack-3'),
  ('emp-kira', 'comp-pack-6'),
  ('emp-joel', 'comp-pack-3'),
  ('emp-joel', 'comp-pack-9'),
  ('emp-maia', 'comp-pack-6'),
  ('emp-maia', 'comp-pack-9'),
  ('emp-rhett', 'comp-pack-3'),
  ('emp-rhett', 'comp-pack-6'),
  ('emp-dina', 'comp-pack-3'),
  ('emp-dina', 'comp-pack-9'),
  ('emp-finn', 'comp-pack-6'),
  ('emp-finn', 'comp-pack-9'),
  ('emp-gia', 'comp-pack-3'),
  ('emp-gia', 'comp-pack-6'),
  ('emp-gia', 'comp-pack-9'),
  ('emp-leo', 'comp-pack-6')
on conflict (employee_id, competency_id) do nothing;

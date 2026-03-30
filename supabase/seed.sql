insert into production_units (id, name, description)
values
  ('unit-casting', 'Casting Hall', 'High-throughput production line with rotating post coverage.'),
  ('unit-dispatch', 'Dispatch Yard', 'Outbound flow with dock, scale, and release coverage.')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description;

insert into teams (id, unit_id, name)
values
  ('team-orbit', 'unit-casting', 'Orbit Crew'),
  ('team-anchor', 'unit-casting', 'Anchor Crew'),
  ('team-vector', 'unit-dispatch', 'Vector Crew')
on conflict (id) do update
set
  unit_id = excluded.unit_id,
  name = excluded.name;

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

insert into employees (id, team_id, full_name, role_title, schedule_code, rotation_anchor)
values
  ('emp-ava', 'team-orbit', 'Ava Patel', 'Senior Operator', '601', 0),
  ('emp-noah', 'team-orbit', 'Noah Kim', 'Relief Operator', '602', 1),
  ('emp-jules', 'team-orbit', 'Jules Martin', 'Coordinator', '603', 2),
  ('emp-mika', 'team-orbit', 'Mika Stone', 'Operator', '604', 3),
  ('emp-siena', 'team-anchor', 'Siena Morales', 'Team Lead', '601', 4),
  ('emp-owen', 'team-anchor', 'Owen Clarke', 'Operator', '602', 5),
  ('emp-rina', 'team-anchor', 'Rina Das', 'Utility Relief', '603', 6),
  ('emp-teo', 'team-anchor', 'Teo Ramirez', 'Operator', '604', 7),
  ('emp-cam', 'team-vector', 'Cam Russell', 'Dispatch Lead', '601', 8),
  ('emp-lena', 'team-vector', 'Lena Abbas', 'Yard Specialist', '602', 9),
  ('emp-eli', 'team-vector', 'Eli Foster', 'Coordinator', '603', 10),
  ('emp-zara', 'team-vector', 'Zara Shah', 'Relief Operator', '604', 11)
on conflict (id) do update
set
  team_id = excluded.team_id,
  full_name = excluded.full_name,
  role_title = excluded.role_title,
  schedule_code = excluded.schedule_code,
  rotation_anchor = excluded.rotation_anchor;

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
  ('emp-zara', 'comp-dock-9')
on conflict (employee_id, competency_id) do nothing;

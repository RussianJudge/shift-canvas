insert into companies (id, name)
values
  ('company-suncor', 'Suncor')
on conflict (id) do update
set
  name = excluded.name;

insert into sites (id, company_id, name)
values
  ('site-mildred-lake', 'company-suncor', 'Mildred Lake')
on conflict (id) do update
set
  company_id = excluded.company_id,
  name = excluded.name;

insert into business_areas (id, site_id, name)
values
  ('business-area-sgd', 'site-mildred-lake', 'SG&D')
on conflict (id) do update
set
  site_id = excluded.site_id,
  name = excluded.name;

insert into production_units (id, name, description, company_id, site_id, business_area_id)
values
  ('unit-casting', 'Casting Hall', 'High-throughput production line with rotating post coverage.', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('unit-dispatch', 'Dispatch Yard', 'Outbound flow with dock, scale, and release coverage.', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('unit-packaging', 'Packaging Floor', 'Pack-out, palletizing, and final QA staging.', 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

insert into schedules (id, name, start_date, day_shift_days, night_shift_days, off_days, company_id, site_id, business_area_id)
values
  ('schedule-601', '601', '2026-01-01', 3, 3, 6, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('schedule-602', '602', '2026-01-04', 3, 3, 6, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('schedule-603', '603', '2026-01-07', 3, 3, 6, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('schedule-604', '604', '2026-01-10', 3, 3, 6, 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (id) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  day_shift_days = excluded.day_shift_days,
  night_shift_days = excluded.night_shift_days,
  off_days = excluded.off_days,
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

insert into competencies (id, code, label, color_token, required_staff, company_id, site_id, business_area_id)
values
  ('comp-post-1', 'Post 1', 'Furnace feed', 'amber', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-post-11', 'Post 11', 'Mold prep', 'teal', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-post-12', 'Post 12', 'Pour line', 'violet', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-post-21', 'Post 21', 'Quality bay', 'rose', 1, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-dock-2', 'Dock 2', 'Scale + manifest', 'blue', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-dock-7', 'Dock 7', 'Release gate', 'lime', 1, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-dock-9', 'Dock 9', 'Outbound staging', 'orange', 1, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-pack-3', 'Pack 3', 'Case pack line', 'teal', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-pack-6', 'Pack 6', 'Palletizing', 'blue', 2, 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('comp-pack-9', 'Pack 9', 'Final QA hold', 'rose', 1, 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (id) do update
set
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token,
  required_staff = excluded.required_staff,
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

insert into time_codes (id, code, label, color_token, company_id, site_id, business_area_id)
values
  ('time-ill', 'ILL', 'Illness', 'rose', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-absa', 'ABSA', 'Absent', 'orange', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-bot', 'BOT', 'Booked off', 'amber', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-days', 'DAY', 'Day shift', 'blue', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-nights', 'NIGHT', 'Night shift', 'violet', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-sim', 'SIM', 'Simulation', 'teal', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('time-v', 'V', 'Vacation', 'lime', 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (id) do update
set
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token,
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

insert into employees (id, schedule_id, full_name, role_title, company_id, site_id, business_area_id)
values
  ('emp-ava', 'schedule-601', 'Ava Patel', 'Senior Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-noah', 'schedule-602', 'Noah Kim', 'Relief Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-jules', 'schedule-603', 'Jules Martin', 'Coordinator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-mika', 'schedule-604', 'Mika Stone', 'Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-siena', 'schedule-601', 'Siena Morales', 'Team Lead', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-owen', 'schedule-602', 'Owen Clarke', 'Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-cam', 'schedule-601', 'Cam Russell', 'Dispatch Lead', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-lena', 'schedule-602', 'Lena Abbas', 'Yard Specialist', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-eli', 'schedule-603', 'Eli Foster', 'Coordinator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-zara', 'schedule-604', 'Zara Shah', 'Relief Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-kira', 'schedule-601', 'Kira Walsh', 'Packaging Lead', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-joel', 'schedule-602', 'Joel Park', 'Case Packer', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-maia', 'schedule-603', 'Maia Chen', 'QA Tech', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-rhett', 'schedule-604', 'Rhett Cole', 'Forklift Operator', 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (id) do update
set
  schedule_id = excluded.schedule_id,
  full_name = excluded.full_name,
  role_title = excluded.role_title,
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

insert into employee_competencies (employee_id, competency_id, company_id, site_id, business_area_id)
values
  ('emp-ava', 'comp-post-1', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-ava', 'comp-post-11', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-ava', 'comp-post-12', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-noah', 'comp-post-11', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-noah', 'comp-post-21', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-jules', 'comp-post-12', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-jules', 'comp-post-21', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-mika', 'comp-post-1', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-mika', 'comp-post-12', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-siena', 'comp-post-1', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-siena', 'comp-post-21', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-owen', 'comp-post-11', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-owen', 'comp-post-12', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-cam', 'comp-dock-2', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-cam', 'comp-dock-7', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-lena', 'comp-dock-7', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-lena', 'comp-dock-9', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-eli', 'comp-dock-2', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-eli', 'comp-dock-9', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-zara', 'comp-dock-2', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-zara', 'comp-dock-7', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-zara', 'comp-dock-9', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-kira', 'comp-pack-3', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-kira', 'comp-pack-6', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-joel', 'comp-pack-3', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-joel', 'comp-pack-9', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-maia', 'comp-pack-6', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-maia', 'comp-pack-9', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-rhett', 'comp-pack-3', 'company-suncor', 'site-mildred-lake', 'business-area-sgd'),
  ('emp-rhett', 'comp-pack-6', 'company-suncor', 'site-mildred-lake', 'business-area-sgd')
on conflict (employee_id, competency_id) do update
set
  company_id = excluded.company_id,
  site_id = excluded.site_id,
  business_area_id = excluded.business_area_id;

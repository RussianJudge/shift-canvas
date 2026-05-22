update public.schedule_assignments as assignment
set
  schedule_id = employee.schedule_id,
  company_id = employee.company_id,
  site_id = employee.site_id,
  business_area_id = employee.business_area_id
from public.employees as employee
where assignment.employee_id = employee.id
  and (
    assignment.schedule_id is distinct from employee.schedule_id
    or assignment.company_id is distinct from employee.company_id
    or assignment.site_id is distinct from employee.site_id
    or assignment.business_area_id is distinct from employee.business_area_id
  );

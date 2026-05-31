alter table public.account_invites
  drop constraint if exists account_invites_check;

alter table public.account_invites
  add constraint account_invites_check
  check (
    (role = 'admin' and company_id is not null and site_id is not null and business_area_id is not null)
    or
    (role in ('leader', 'worker') and employee_id is not null)
  );

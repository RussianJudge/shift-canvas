create table if not exists public.mutual_settings (
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  max_shifts_per_posting integer check (max_shifts_per_posting is null or max_shifts_per_posting > 0),
  posting_horizon_months integer not null default 12 check (posting_horizon_months > 0),
  require_leader_approval boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (company_id, site_id, business_area_id)
);

drop trigger if exists mutual_settings_updated_at on public.mutual_settings;
create trigger mutual_settings_updated_at
before update on public.mutual_settings
for each row
execute function public.update_sub_schedule_timestamp();

alter table public.mutual_settings enable row level security;

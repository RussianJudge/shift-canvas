create table if not exists public.mutual_shift_postings (
  id text primary key,
  owner_employee_id text not null references public.employees(id) on delete cascade,
  owner_schedule_id text not null references public.schedules(id) on delete cascade,
  status text not null check (status in ('open', 'accepted', 'withdrawn', 'cancelled')),
  month_key text not null,
  accepted_application_id text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists mutual_shift_postings_month_idx
  on public.mutual_shift_postings (month_key, status);

create index if not exists mutual_shift_postings_owner_idx
  on public.mutual_shift_postings (owner_employee_id, status);

create table if not exists public.mutual_shift_posting_dates (
  posting_id text not null references public.mutual_shift_postings(id) on delete cascade,
  swap_date date not null,
  shift_kind text not null check (shift_kind in ('DAY', 'NIGHT')),
  primary key (posting_id, swap_date)
);

create table if not exists public.mutual_shift_applications (
  id text primary key,
  posting_id text not null references public.mutual_shift_postings(id) on delete cascade,
  applicant_employee_id text not null references public.employees(id) on delete cascade,
  applicant_schedule_id text not null references public.schedules(id) on delete cascade,
  status text not null check (status in ('open', 'accepted', 'withdrawn', 'rejected')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists mutual_shift_applications_posting_idx
  on public.mutual_shift_applications (posting_id, status);

create index if not exists mutual_shift_applications_employee_idx
  on public.mutual_shift_applications (applicant_employee_id, status);

create table if not exists public.mutual_shift_application_dates (
  application_id text not null references public.mutual_shift_applications(id) on delete cascade,
  swap_date date not null,
  shift_kind text not null check (shift_kind in ('DAY', 'NIGHT')),
  primary key (application_id, swap_date)
);

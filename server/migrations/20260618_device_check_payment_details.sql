create table if not exists public.device_check_payment_details (
  payment_request_id uuid primary key references public.payment_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payee_name text not null,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  state_province text not null,
  postal_code text not null,
  country text not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists device_check_payment_details_user_id_idx
  on public.device_check_payment_details(user_id);

alter table public.device_check_payment_details enable row level security;
revoke all on public.device_check_payment_details from anon, authenticated;
grant all on public.device_check_payment_details to service_role;

notify pgrst, 'reload schema';

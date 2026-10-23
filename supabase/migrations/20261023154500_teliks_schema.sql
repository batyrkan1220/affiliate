-- Teliks Supabase (project "teliks"). Server-only tables: RLS on, no policies (service role).
create table if not exists public.partners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trendme_code text not null unique check (trendme_code ~ '^[a-z0-9]{4,24}$'),
  name text not null check (char_length(name) between 1 and 80),
  email text,
  payout_method text check (payout_method in ('kaspi', 'card', 'usdt', 'bank')),
  payout_value text check (payout_value is null or char_length(payout_value) <= 64),
  payout_updated_at timestamptz,
  active boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.partners enable row level security;

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.partners(user_id) on delete cascade,
  amount_kzt int not null check (amount_kzt > 0),
  method text not null,
  details text not null,
  status text not null default 'processing' check (status in ('processing', 'paid', 'rejected')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists payout_requests_user_idx on public.payout_requests(user_id, created_at desc);
create index if not exists payout_requests_status_idx on public.payout_requests(status, created_at);
alter table public.payout_requests enable row level security;

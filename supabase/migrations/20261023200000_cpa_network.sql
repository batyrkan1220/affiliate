-- Teliks as a self-hosted CPA network: advertisers, offers, partner access, clicks, conversions,
-- postback log. Server-only tables: RLS on, no policies (service role only).

create table if not exists public.advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  company text check (company is null or char_length(company) <= 120),
  email text check (email is null or char_length(email) <= 254),
  telegram text check (telegram is null or char_length(telegram) <= 64),
  website text check (website is null or char_length(website) <= 300),
  notes text check (notes is null or char_length(notes) <= 2000),
  api_key_hash text unique,          -- sha256 of the key; the key itself is shown once
  api_key_prefix text,               -- first characters, to recognise the key in the admin
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);
alter table public.advertisers enable row level security;

create table if not exists public.offers (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  advertiser_id uuid not null references public.advertisers(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 5000),
  kpi text check (kpi is null or char_length(kpi) <= 3000),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  preview_url text check (preview_url is null or preview_url ~ '^https?://'),
  target_url text not null check (target_url ~ '^https?://' and position('{click_id}' in target_url) > 0),
  categories text[] not null default '{}',
  geo text[] not null default '{}',
  model text not null default 'CPA' check (model in ('CPA', 'CPL', 'CPS', 'CPI', 'RevShare')),
  -- [{code, name, payout_type: fixed|percent, payout, revenue_type: fixed|percent, revenue}]
  goals jsonb not null default '[]' check (jsonb_typeof(goals) = 'array'),
  hold_days int not null default 0 check (hold_days between 0 and 90),
  daily_cap int check (daily_cap is null or daily_cap > 0),
  access text not null default 'approval' check (access in ('open', 'approval', 'private')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offers_advertiser_idx on public.offers(advertiser_id);
alter table public.offers enable row level security;

create table if not exists public.offer_access (
  offer_id text not null references public.offers(id) on delete cascade,
  user_id uuid not null references public.partners(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (offer_id, user_id)
);
create index if not exists offer_access_status_idx on public.offer_access(status, created_at);
alter table public.offer_access enable row level security;

create table if not exists public.clicks (
  id text primary key check (id ~ '^[A-Za-z0-9]{16,32}$'),
  offer_id text not null references public.offers(id) on delete cascade,
  user_id uuid not null references public.partners(user_id) on delete cascade,
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text,
  source text, sub_aff_id text, aff_click_id text,
  ip inet, country text, device text, os text, browser text,
  ua text check (ua is null or char_length(ua) <= 400),
  referer text check (referer is null or char_length(referer) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists clicks_user_time_idx on public.clicks(user_id, created_at);
create index if not exists clicks_offer_time_idx on public.clicks(offer_id, created_at);
create index if not exists clicks_time_idx on public.clicks(created_at);
alter table public.clicks enable row level security;

create table if not exists public.conversions (
  id uuid primary key default gen_random_uuid(),
  click_id text references public.clicks(id) on delete set null,
  offer_id text not null references public.offers(id) on delete restrict,
  user_id uuid not null references public.partners(user_id) on delete restrict,
  advertiser_id uuid not null references public.advertisers(id) on delete restrict,
  goal text not null default 'default' check (char_length(goal) between 1 and 32),
  external_id text check (external_id is null or char_length(external_id) <= 100),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  adv_status text check (adv_status in ('pending', 'approved', 'rejected')),
  payout_kzt numeric(14, 2) not null default 0 check (payout_kzt >= 0),
  revenue_kzt numeric(14, 2) not null default 0 check (revenue_kzt >= 0),
  sale_amount_kzt numeric(14, 2) check (sale_amount_kzt is null or sale_amount_kzt >= 0),
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text, source text, country text,
  note text check (note is null or char_length(note) <= 300),
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists conversions_ext_uq on public.conversions(offer_id, goal, external_id) where external_id is not null;
create unique index if not exists conversions_click_goal_uq on public.conversions(click_id, goal) where external_id is null and click_id is not null;
create index if not exists conversions_user_time_idx on public.conversions(user_id, created_at);
create index if not exists conversions_time_idx on public.conversions(created_at);
create index if not exists conversions_hold_idx on public.conversions(hold_until) where status = 'pending' and adv_status = 'approved';
alter table public.conversions enable row level security;

create table if not exists public.postback_log (
  id bigserial primary key,
  direction text not null check (direction in ('in', 'out')),
  advertiser_id uuid references public.advertisers(id) on delete set null,
  user_id uuid references public.partners(user_id) on delete set null,
  offer_id text,
  conversion_id uuid,
  summary text check (summary is null or char_length(summary) <= 600),
  http_status int,
  ok boolean not null default false,
  message text check (message is null or char_length(message) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists postback_log_time_idx on public.postback_log(created_at desc);
alter table public.postback_log enable row level security;

alter table public.partners add column if not exists postback_url text check (postback_url is null or (postback_url ~ '^https://' and char_length(postback_url) <= 600));
-- Part of a paid request that was recorded in TrendMe (the rest pays Teliks-native earnings).
alter table public.payout_requests add column if not exists trendme_kzt int check (trendme_kzt is null or trendme_kzt >= 0);

/* ───── aggregates (Almaty days) ───── */
-- Results come back as one jsonb value (PostgREST caps row sets at 1000 rows).
create or replace function public.cpa_click_rows(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select (c.created_at at time zone 'Asia/Almaty')::date as day, extract(hour from c.created_at at time zone 'Asia/Almaty')::int as hour,
           c.offer_id, coalesce(c.country, '') as country, coalesce(c.device, '') as device, coalesce(c.os, '') as os,
           coalesce(c.browser, '') as browser, coalesce(c.source, '') as source,
           coalesce(c.sub1, '') as sub1, coalesce(c.sub2, '') as sub2, coalesce(c.sub3, '') as sub3, coalesce(c.sub4, '') as sub4, coalesce(c.sub5, '') as sub5,
           count(*) as clicks, count(distinct c.ip) as uniq
    from public.clicks c
    where (p_user is null or c.user_id = p_user) and c.created_at >= p_from and c.created_at < p_to
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
    limit 20000
  ) t;
$$;

create or replace function public.cpa_daily(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (
    select (created_at at time zone 'Asia/Almaty')::date d, offer_id, user_id, count(*) n, count(distinct ip) u
    from public.clicks where created_at >= p_from and created_at < p_to group by 1, 2, 3
  ), v as (
    select (created_at at time zone 'Asia/Almaty')::date d, offer_id, user_id,
           count(*) filter (where status = 'approved') a, count(*) filter (where status = 'pending') p, count(*) filter (where status = 'rejected') r,
           coalesce(sum(payout_kzt) filter (where status = 'approved'), 0) pay,
           coalesce(sum(payout_kzt) filter (where status = 'pending'), 0) ppay,
           coalesce(sum(revenue_kzt) filter (where status = 'approved'), 0) rev,
           coalesce(sum(revenue_kzt) filter (where status = 'pending'), 0) prev,
           coalesce(sum(sale_amount_kzt) filter (where status <> 'rejected'), 0) sales
    from public.conversions where created_at >= p_from and created_at < p_to group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', coalesce(k.d, v.d), 'offer_id', coalesce(k.offer_id, v.offer_id), 'user_id', coalesce(k.user_id, v.user_id),
    'clicks', coalesce(k.n, 0), 'uniq', coalesce(k.u, 0), 'approved', coalesce(v.a, 0), 'pending', coalesce(v.p, 0), 'rejected', coalesce(v.r, 0),
    'payout_kzt', coalesce(v.pay, 0), 'pending_payout_kzt', coalesce(v.ppay, 0), 'revenue_kzt', coalesce(v.rev, 0),
    'pending_revenue_kzt', coalesce(v.prev, 0), 'sales_kzt', coalesce(v.sales, 0))), '[]'::jsonb)
  from k full join v on k.d = v.d and k.offer_id = v.offer_id and k.user_id = v.user_id;
$$;

create or replace function public.cpa_balances(p_user uuid)
returns table (user_id uuid, approved_kzt numeric, pending_kzt numeric)
language sql stable security definer set search_path = public as $$
  select c.user_id, coalesce(sum(c.payout_kzt) filter (where c.status = 'approved'), 0), coalesce(sum(c.payout_kzt) filter (where c.status = 'pending'), 0)
  from public.conversions c where p_user is null or c.user_id = p_user group by c.user_id;
$$;

create or replace function public.cpa_cap_used(p_offer text, p_since timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.conversions where offer_id = p_offer and created_at >= p_since and status <> 'rejected';
$$;

-- Advertiser approved, hold is over → the partner gets the money.
create or replace function public.cpa_release_holds()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.conversions set status = 'approved', updated_at = now()
  where status = 'pending' and adv_status = 'approved' and hold_until is not null and hold_until <= now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.cpa_click_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cpa_daily(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cpa_balances(uuid) from public, anon, authenticated;
revoke all on function public.cpa_cap_used(text, timestamptz) from public, anon, authenticated;
revoke all on function public.cpa_release_holds() from public, anon, authenticated;
grant execute on function public.cpa_click_rows(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.cpa_daily(timestamptz, timestamptz) to service_role;
grant execute on function public.cpa_balances(uuid) to service_role;
grant execute on function public.cpa_cap_used(text, timestamptz) to service_role;
grant execute on function public.cpa_release_holds() to service_role;

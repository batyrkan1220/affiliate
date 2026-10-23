-- Offer details for the admin editor: creatives, allowed/banned traffic, run dates, internal notes.
alter table public.offers add column if not exists creatives jsonb not null default '[]' check (jsonb_typeof(creatives) = 'array');
alter table public.offers add column if not exists traffic_allowed text[] not null default '{}';
alter table public.offers add column if not exists traffic_banned text[] not null default '{}';
alter table public.offers add column if not exists starts_on date;
alter table public.offers add column if not exists ends_on date;
alter table public.offers add column if not exists notes text check (notes is null or char_length(notes) <= 2000);

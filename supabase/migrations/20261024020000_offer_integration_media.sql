-- Built-in offers (TrendMe): their catalog card (name, photo, texts, creatives, visibility) is edited
-- in Teliks; tracking and money stay in TrendMe. Plus a public bucket for offer photos/creatives
-- (uploads go through the Teliks server with the service key; nobody else can write).
alter table public.offers add column if not exists integration text check (integration is null or integration in ('trendme'));
create unique index if not exists offers_integration_uq on public.offers(integration) where integration is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('offer-media', 'offer-media', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Built-in integrations: an advertiser whose offer is tracked by its own API, not by /c/ links + postbacks.
alter table public.advertisers add column if not exists integration text check (integration is null or integration in ('trendme'));
create unique index if not exists advertisers_integration_uq on public.advertisers(integration) where integration is not null;

insert into public.advertisers (name, company, website, telegram, notes, integration, status)
select 'TrendMe', 'TrendMe — AI тренд-видео', 'https://trendme.kz', '@Trendmekzbot',
       'Встроенная интеграция: партнёрские ссылки бота/Mini App/сайта, клиенты, оплаты и % партнёра считает TrendMe и передаёт в Teliks по API (TRENDME_API_URL / TRENDME_API_SECRET). Постбэк и ключ не нужны.',
       'trendme', 'active'
where not exists (select 1 from public.advertisers where integration = 'trendme');

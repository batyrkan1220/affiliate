-- Payout flow: partner can cancel; admin writes a payment reference or a rejection reason;
-- one open request per partner (no double requests against the same balance).
alter table public.payout_requests drop constraint if exists payout_requests_status_check;
alter table public.payout_requests add constraint payout_requests_status_check check (status in ('processing', 'paid', 'rejected', 'cancelled'));
alter table public.payout_requests add column if not exists paid_ref text check (paid_ref is null or char_length(paid_ref) <= 200);
alter table public.payout_requests add column if not exists processed_by text check (processed_by is null or char_length(processed_by) <= 254);
create unique index if not exists payout_requests_one_open_uq on public.payout_requests(user_id) where status = 'processing';

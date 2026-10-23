alter table camps
  add column if not exists external_id text,
  add column if not exists location text,
  add column if not exists booking_fee numeric(10,2) not null default 0,
  add column if not exists booking_deadline date,
  add column if not exists full_payment_deadline date,
  add column if not exists active boolean not null default true;

alter table camps add constraint camps_club_external_unique unique (club_id, external_id);

create table camp_tariffs (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null,
  active boolean not null default true,
  unique (camp_id, name)
);

alter table camp_participants
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists external_id text,
  add column if not exists tariff_id uuid references camp_tariffs(id),
  add column if not exists amount numeric(10,2) not null default 0,
  add column if not exists tshirt_size text,
  add column if not exists comment text,
  add column if not exists status text not null default 'registered',
  add column if not exists registered_on date;

update camp_participants set id = gen_random_uuid() where id is null;
alter table camp_participants alter column id set not null;
alter table camp_participants drop constraint camp_participants_pkey;
alter table camp_participants add primary key (id);
alter table camp_participants add constraint camp_participants_camp_player_unique unique (camp_id, player_id);
alter table camp_participants add constraint camp_participants_camp_external_unique unique (camp_id, external_id);
alter table camp_participants add constraint camp_participants_status_check check (status in ('registered', 'declined'));

create table camp_payments (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id) on delete cascade,
  participant_id uuid not null references camp_participants(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null,
  paid_on date not null,
  kind text not null check (kind in ('booking', 'payment', 'refund')),
  method text,
  comment text,
  legacy_ref text unique,
  created_at timestamptz not null default now()
);

alter table club_settings add column if not exists scope text not null default '';
alter table club_settings add column if not exists updated_at date;
alter table club_settings drop constraint club_settings_pkey;
alter table club_settings add primary key (club_id, key, scope);

alter table camp_tariffs enable row level security;
alter table camp_payments enable row level security;

create policy camp_tariffs_read on camp_tariffs for select using (auth.uid() is not null);
create policy camp_tariffs_admin on camp_tariffs for all using (is_admin()) with check (is_admin());
create policy camp_payments_read on camp_payments for select
  using (is_admin() or is_guardian_of(player_id));
create policy camp_payments_admin on camp_payments for all using (is_admin()) with check (is_admin());

grant select, insert, update, delete on camp_tariffs, camp_payments to authenticated, service_role;

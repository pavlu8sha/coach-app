-- 0003: остальные данные из таблиц. Черновик 2026-10-22.
-- Все новые таблицы — с включённым RLS и без политик: пока не применены политики (0004), никто ничего не видит.
-- Права выдаются явно (как в 0002).

-- Цены: по группе или общие, с месяца начала действия (лист «ЦЕНЫ»)
create table prices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  group_id uuid references groups(id),
  kind text not null check (kind in ('subscription', 'individual', 'extra', 'match_fee')),
  amount numeric(10,2) not null,
  valid_from date not null,
  valid_to date
);

-- Абонементы по месяцам (лист месяца оплат: игрок × месяц × группа)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  group_id uuid references groups(id),
  month date not null,                   -- первое число месяца
  amount_due numeric(10,2) not null default 0,
  discount boolean not null default false,
  note text,
  unique (player_id, month)
);

-- Журнал платежей (ledger): только добавление
create table payments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  subscription_id uuid references subscriptions(id),
  amount numeric(10,2) not null,
  paid_on date not null,
  method text,                           -- наличные / перевод и т.д.
  recorded_by uuid references users(id),
  legacy_ref text                        -- строка из таблицы, для миграции
);

-- Экипировка: заказ и строки заказа (количество по комплектам)
create table equipment_catalog (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  kit text not null,
  price numeric(10,2) not null,
  valid_from date not null,
  unique (club_id, kit, valid_from)
);

create table equipment_orders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  player_id uuid references players(id),
  external_ord_id text,                  -- «ORD id» из таблицы, для миграции
  ordered_on date not null,
  inscription text,
  number text,
  installment boolean not null default false,
  total numeric(10,2) not null default 0,
  paid numeric(10,2) not null default 0,
  location text,
  unique (club_id, external_ord_id)
);

create table equipment_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references equipment_orders(id) on delete cascade,
  kit text not null,
  size text,
  quantity int not null default 1 check (quantity between 1 and 10),
  unit_price numeric(10,2) not null
);

-- Матчи: взнос и посещаемость игр
create table match_fees (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null,
  paid boolean not null default false,
  unique (match_id, player_id)
);

-- Лагеря и пробные: события и участники
create table camps (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  name text not null,
  starts_on date not null,
  ends_on date not null
);
create table camp_participants (
  camp_id uuid not null references camps(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  primary key (camp_id, player_id)
);

create table trials (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  full_name text not null,
  phone text,                            -- персональные данные: доступ только администратору
  source text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- Расписание групп по дням недели
create table weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time,
  location text
);

-- Настройки клуба (лист «НАСТРОЙКИ»)
create table club_settings (
  club_id uuid not null references clubs(id),
  key text not null,
  value text,
  primary key (club_id, key)
);

-- Права: доступ выдаём, строки ограничит RLS в 0004
grant select, insert, update, delete on
  prices, subscriptions, payments, equipment_catalog, equipment_orders, equipment_order_lines,
  match_fees, camps, camp_participants, trials, weekly_schedule, club_settings
to authenticated;

alter table prices enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table equipment_catalog enable row level security;
alter table equipment_orders enable row level security;
alter table equipment_order_lines enable row level security;
alter table match_fees enable row level security;
alter table camps enable row level security;
alter table camp_participants enable row level security;
alter table trials enable row level security;
alter table weekly_schedule enable row level security;
alter table club_settings enable row level security;

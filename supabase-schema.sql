-- Mis Finanzas — esquema Supabase
-- Cómo aplicarlo: Supabase → tu proyecto → SQL Editor → New query → pega
-- este archivo completo → Run. Es seguro volver a correrlo (usa IF NOT EXISTS
-- / DROP POLICY IF EXISTS), así que si algo falla a la mitad puedes reintentar.

create extension if not exists pgcrypto;

-- ---------- Tablas ----------
-- Espejo 1:1 de las claves de `state` que la app ya usaba en localStorage.

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('gasto', 'ingreso')),
  category text not null,
  amount numeric not null,
  date date not null,
  note text default '',
  fixed_expense_id uuid,
  source text,
  created_at timestamptz default now()
);

create table if not exists fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('gasto', 'ingreso')),
  name text not null,
  category text not null,
  amount numeric not null,
  created_at timestamptz default now()
);

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  total_amount numeric not null,
  original_total numeric not null,
  monthly_payment numeric not null,
  remaining_months integer not null,
  created_at timestamptz default now()
);

create table if not exists receivables (
  id uuid primary key default gen_random_uuid(),
  who text not null,
  amount numeric not null,
  estimated_date date,
  paid boolean not null default false,
  paid_date date,
  created_at timestamptz default now()
);

create table if not exists expected_incomes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null,
  expected_date date,
  received boolean not null default false,
  received_date date,
  created_at timestamptz default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_amount numeric not null,
  saved_amount numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists income_allocations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('goal', 'debt')),
  target_id uuid not null,
  amount numeric not null,
  date date not null,
  created_at timestamptz default now()
);

-- ---------- Row Level Security ----------
-- Activada en las 7 tablas. Esta app NO usa Supabase Auth (solo una
-- contraseña simple en el cliente), así que no hay un usuario autenticado
-- contra el que restringir filas. La política de abajo permite acceso
-- completo a quien tenga la publishable key (que vive en el HTML/JS de la
-- app — no es secreta). RLS queda "activada" tal como se pidió, pero sin
-- Auth real esto es una puerta de UI, no una protección de datos a nivel de
-- base. Si más adelante se agrega Supabase Auth, estas políticas se pueden
-- endurecer para exigir un usuario autenticado.

alter table transactions enable row level security;
alter table fixed_expenses enable row level security;
alter table debts enable row level security;
alter table receivables enable row level security;
alter table expected_incomes enable row level security;
alter table goals enable row level security;
alter table income_allocations enable row level security;

drop policy if exists "allow all" on transactions;
drop policy if exists "allow all" on fixed_expenses;
drop policy if exists "allow all" on debts;
drop policy if exists "allow all" on receivables;
drop policy if exists "allow all" on expected_incomes;
drop policy if exists "allow all" on goals;
drop policy if exists "allow all" on income_allocations;

create policy "allow all" on transactions for all using (true) with check (true);
create policy "allow all" on fixed_expenses for all using (true) with check (true);
create policy "allow all" on debts for all using (true) with check (true);
create policy "allow all" on receivables for all using (true) with check (true);
create policy "allow all" on expected_incomes for all using (true) with check (true);
create policy "allow all" on goals for all using (true) with check (true);
create policy "allow all" on income_allocations for all using (true) with check (true);

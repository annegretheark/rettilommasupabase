create table if not exists public.hov_regnskapsintegrasjoner (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid not null,
  leverandor text not null check (leverandor in ('poweroffice','tripletex','fiken','fortnox','visma','none')),
  status text not null default 'frakoblet',
  miljo text not null default 'demo',
  innstillinger jsonb not null default '{}'::jsonb,
  sist_testet timestamptz,
  sist_feil text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firma_id, leverandor)
);

alter table public.hov_regnskapsintegrasjoner enable row level security;

-- PowerOffice-feltene legges bare til dersom fakturatabellen allerede finnes.
-- Dette gjør migrasjonen trygg i installasjoner der hov_fakturaer opprettes
-- av en annen migrasjon eller ikke er tatt i bruk ennå.
do $$
begin
  if to_regclass('public.hov_fakturaer') is not null then
    alter table public.hov_fakturaer
      add column if not exists poweroffice_order_id text;

    alter table public.hov_fakturaer
      add column if not exists poweroffice_customer_id text;

    create unique index if not exists hov_fakturaer_poweroffice_order_uidx
      on public.hov_fakturaer(poweroffice_order_id)
      where poweroffice_order_id is not null;
  else
    raise notice 'Tabellen public.hov_fakturaer finnes ikke. PowerOffice-kolonner og indeks hoppes over.';
  end if;
end
$$;

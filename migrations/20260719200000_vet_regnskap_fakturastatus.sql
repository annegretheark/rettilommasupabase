-- Sporbar kobling mellom lokal faktura og regnskapssystem.
-- Eldre installasjoner har fakturaopplysningene bare på vet_journal.
do $sql$
begin
  if to_regclass('public.fakturaer') is not null then
    alter table public.fakturaer
      add column if not exists regnskap_leverandor text,
      add column if not exists ekstern_faktura_id text,
      add column if not exists regnskap_status text,
      add column if not exists regnskap_synkronisert_at timestamptz;
    create index if not exists fakturaer_ekstern_faktura_idx
      on public.fakturaer(regnskap_leverandor, ekstern_faktura_id)
      where ekstern_faktura_id is not null;
  end if;

  if to_regclass('public.vet_journal') is not null then
    alter table public.vet_journal
      add column if not exists regnskap_leverandor text,
      add column if not exists ekstern_faktura_id text,
      add column if not exists regnskap_status text,
      add column if not exists regnskap_synkronisert_at timestamptz;
    create index if not exists vet_journal_ekstern_faktura_idx
      on public.vet_journal(regnskap_leverandor, ekstern_faktura_id)
      where ekstern_faktura_id is not null;
  end if;
end
$sql$;

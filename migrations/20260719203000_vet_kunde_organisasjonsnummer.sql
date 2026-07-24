-- Bedriftskunde og EHF-identifikasjon.
alter table if exists public.vet_dyreeiere
  add column if not exists organisasjonsnummer text;

create index if not exists vet_dyreeiere_klinikk_orgnummer_idx
  on public.vet_dyreeiere(klinikk_id, organisasjonsnummer)
  where organisasjonsnummer is not null;

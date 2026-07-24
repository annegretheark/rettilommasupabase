-- GPS-felter på dyreeier/kunde. Trygg å kjøre flere ganger.
alter table if exists public.vet_dyreeiere
  add column if not exists gps_lat double precision null,
  add column if not exists gps_lon double precision null,
  add column if not exists gps_adresse text null,
  add column if not exists gps_oppdatert_at timestamptz null;

alter table if exists public.vet_dyreeiere
  drop constraint if exists vet_dyreeiere_gps_lat_check,
  drop constraint if exists vet_dyreeiere_gps_lon_check;

alter table if exists public.vet_dyreeiere
  add constraint vet_dyreeiere_gps_lat_check check (gps_lat is null or gps_lat between -90 and 90),
  add constraint vet_dyreeiere_gps_lon_check check (gps_lon is null or gps_lon between -180 and 180);


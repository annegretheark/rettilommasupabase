# daglig-appfaktura

Denne Edge Function lager appfakturaer automatisk:

- Dag 1-30: daglig 0-faktura.
- Fra dag 31: faktura på 400 kr eks. mva + 25 % mva = 500 kr inkl. mva.
- Fakturafil lagres i Supabase Storage:
  `rettilomma/hovslager/fakturaer/YYYY/MM/`

## Installer

1. Kjør SQL-filen:
   `supabase/sql/2026-07-02_daglig_appfaktura.sql`

2. Deploy function:
   ```bash
   supabase functions deploy daglig-appfaktura --no-verify-jwt
   ```

3. Kjør test:
   ```bash
   supabase functions invoke daglig-appfaktura --body '{"action":"daily"}'
   ```

4. Sett schedule i Supabase Dashboard:
   Edge Functions -> daglig-appfaktura -> Schedules -> Daily.


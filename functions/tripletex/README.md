# Tripletex Edge Function for HovslagerSystem

Funksjonen støtter:

- `test_connection`
- `create_invoice` – finner eller oppretter kunden, lager ordre og oppretter faktura i Tripletex.

## Secrets

```powershell
supabase secrets set TRIPLETEX_CONSUMER_TOKEN="..." TRIPLETEX_EMPLOYEE_TOKEN="..." TRIPLETEX_API_BASE="https://api-test.tripletex.tech/v2" TRIPLETEX_VAT_TYPE_ID="3"
```

`TRIPLETEX_VAT_TYPE_ID` er valgfri og har standardverdi `3`. Kontroller at denne MVA-typen er 25 % i Tripletex-kontoen.

## Deploy

```powershell
supabase functions deploy tripletex
```

Knappen **Send til Tripletex** vises på ufakturerte jobber i fakturaoversikten. Kunden søkes først på e-post, ellers navn. Hvis kunden ikke finnes, opprettes den automatisk.

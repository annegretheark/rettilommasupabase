# PowerOffice Go demo – oppsett

Denne pakken inneholder en fungerende, sikker tilkoblingstest mot PowerOffice Go API v2 via Supabase Edge Functions.
Ingen API-nøkler ligger i nettleserkoden eller i denne ZIP-filen.

## 1. Roter nøklene først
Nøklene ble delt i en chat og må behandles som eksponert. Opprett/roter client key og subscription key i PowerOffice før videre bruk.

## 2. Registrer Supabase secrets

```bash
supabase secrets set POWEROFFICE_APPLICATION_KEY="..."
supabase secrets set POWEROFFICE_CLIENT_KEY="..."
supabase secrets set POWEROFFICE_SUBSCRIPTION_KEY="..."
supabase secrets set POWEROFFICE_TOKEN_URL="https://goapi.poweroffice.net/Demo/OAuth/Token"
supabase secrets set POWEROFFICE_BASE_URL="https://goapi.poweroffice.net/Demo/v2"
```

## 3. Distribuer funksjonen

```bash
supabase functions deploy poweroffice
```

## 4. Test i appen
Gå til **Økonomi og integrasjoner**, velg **PowerOffice Go**, lagre systemvalget og trykk **Test tilkobling**.

## Neste steg
Tilkoblingstesten er ferdig. Kundeopprettelse og fakturautkast bør implementeres etter at feltene i PowerOffice v2 OpenAPI er bekreftet mot testklienten. Bruk en unik ekstern referanse per jobb for å hindre dobbeltfakturering.

## Neste steg lagt inn: fakturautkast

Appen kan nå bruke handlingen `create_invoice_draft` for å:

1. finne kunde ved ekstern kode, organisasjonsnummer eller e-post
2. opprette kunden dersom den ikke finnes
3. opprette et fakturautkast/salgsordre med unik `ExternalImportReference`
4. lagre PowerOffice kunde-ID og ordre-ID lokalt

Kjør migrasjonen på nytt og distribuer funksjonen etter oppdateringen.

```bash
supabase db push
supabase functions deploy poweroffice
```

Standard API-stier er `/Customers` og `/SalesOrders`. Dersom OpenAPI-definisjonen i utviklerportalen viser andre stier for abonnementet ditt, kan de overstyres uten kodeendring:

```bash
supabase secrets set POWEROFFICE_CUSTOMERS_PATH="/Customers"
supabase secrets set POWEROFFICE_SALES_ORDERS_PATH="/SalesOrders"
```

Første test bør gjøres med én testkunde og én liten jobb. Utkastet skal kontrolleres i PowerOffice-demo før automatisk sending vurderes.

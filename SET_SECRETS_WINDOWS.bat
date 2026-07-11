@echo off
setlocal
set PROJECT_REF=fxnhkvbfjwrozauaireb
echo Edit this file locally and replace placeholder values before running.
supabase secrets set --project-ref %PROJECT_REF% SUPABASE_URL=https://fxnhkvbfjwrozauaireb.supabase.co SUPABASE_ANON_KEY=PASTE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY BACKUP_CRON_SECRET=PASTE_LONG_RANDOM_SECRET BILLING_CRON_SECRET=PASTE_DIFFERENT_LONG_RANDOM_SECRET

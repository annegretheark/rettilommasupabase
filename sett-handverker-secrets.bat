@echo off
setlocal
set "PROJECT_REF=fxnhkvbfjwrozauaireb"

rem Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY automatically.
rem Only the custom backup cron secret must be set manually.

supabase secrets set --project-ref %PROJECT_REF% BACKUP_CRON_SECRET=5aeb3bcd4f98250dda454dcde248bdfe57a70567a95fe37ecbb642f1005d0794

if errorlevel 1 (
  echo Failed to set BACKUP_CRON_SECRET.
  exit /b 1
)

echo BACKUP_CRON_SECRET was set successfully.
echo Save this value securely because Supabase will not display it again:
echo 5aeb3bcd4f98250dda454dcde248bdfe57a70567a95fe37ecbb642f1005d0794
endlocal

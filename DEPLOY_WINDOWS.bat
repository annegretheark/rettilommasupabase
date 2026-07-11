@echo off
setlocal
set PROJECT_REF=fxnhkvbfjwrozauaireb
where supabase >nul 2>nul || (echo Supabase CLI mangler.& exit /b 1)
supabase link --project-ref %PROJECT_REF% || exit /b 1
supabase functions deploy auto-handverker-backup --project-ref %PROJECT_REF% --no-verify-jwt || exit /b 1
supabase functions deploy daglig-hand-appfaktura --project-ref %PROJECT_REF% --no-verify-jwt || exit /b 1
supabase functions deploy endrehandepost --project-ref %PROJECT_REF% || exit /b 1
supabase functions deploy invite-hand-user --project-ref %PROJECT_REF% || exit /b 1
supabase functions deploy opprett-hand-kunde --project-ref %PROJECT_REF% || exit /b 1
supabase functions list --project-ref %PROJECT_REF%
echo Deployment completed.

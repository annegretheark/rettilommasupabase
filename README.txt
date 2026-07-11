SYSTEMATIC EDGE FUNCTION MIGRATION

Functions included:
- auto-handverker-backup
- daglig-hand-appfaktura
- endrehandepost
- invite-hand-user
- opprett-hand-kunde

Security corrections:
- Backup now uses hand_* tables and hand_sysadm/hand_ansatt, not veterinarian tables.
- Billing requires x-cron-secret or authenticated system administrator.
- Invite and create-user functions require authenticated administrator.
- Partial user creation is rolled back if hand_ansatt insert fails.

Required secrets:
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
BACKUP_CRON_SECRET
BILLING_CRON_SECRET

Order:
1. Copy secrets.example.env and fill values locally.
2. Set secrets in Dashboard or edit and run SET_SECRETS_WINDOWS.bat.
3. Run DEPLOY_WINDOWS.bat from this directory.
4. Verify with: supabase functions list --project-ref fxnhkvbfjwrozauaireb

Never commit service-role or cron secrets.

# Local demo seed

Run only after local Liquibase migrations are applied:

```bash
node scripts/dev/seed-demo-account.js
```

The script is idempotent and refuses non-local `DB_HOST` values unless `DEMO_SEED_ALLOW_NONLOCAL=true` is explicitly set. Do not run it against staging/prod without an explicit plan.

Created data:

- Organization: `CLA Demo Organization` (`cla-demo`)
- Dashboard user: `demo-admin`
- Default password: `demo-password-123` (override with `DEMO_DASHBOARD_PASSWORD`)
- Survey: `cla-demo-survey` (override name with `DEMO_SURVEY_NAME`)
- Respondent tokens: `demo-alex-token`, `demo-blair-token`, `demo-casey-token`

The public `userId=demo` bypass is not used. Demo survey access should use the real respondent links printed by the script.

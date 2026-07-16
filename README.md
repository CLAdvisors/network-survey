# network-survey

## Local development

Use the root scripts instead of starting each service in a separate terminal.

### Prerequisites

- PostgreSQL is already running locally and reachable with the values in `api/.env.local`
- Install dependencies once in the root, `api`, `dashboard`, and `network-survey` packages
- Create local env files from the checked-in examples if they do not already exist

### Commands

- `npm run dev`: validates env files, verifies Postgres is reachable, starts the API first, waits for API readiness, then starts the dashboard and survey app
- `npm run dev:stop`: stops all services started by `npm run dev`
- `npm run db:setup`: ensures local `ONA` database exists, then runs Liquibase migrations from `db/changelogs/master-changelog.xml`
- `npm run db:migrate`: runs Liquibase migrations only (does not create the database)
- `npm run dev:setup`: runs `db:setup` and then starts local development
- `npm run dev:api`: runs the API by itself
- `npm run dev:dashboard`: runs the dashboard by itself
- `npm run dev:survey`: runs the survey app by itself

### Env templates

- `api/.env.local.example`
- `dashboard/.env.development.example`
- `network-survey/.env.development.example`

The API runner treats `RESEND_API_KEY` or `RESEND_KEY` as optional for startup. Email-sending features will fail at runtime if neither key is configured.

Public dashboard self-signup is controlled by `ALLOW_PUBLIC_SIGNUP`. It defaults to enabled only in local/dev/test when unset; set `ALLOW_PUBLIC_SIGNUP=false` for staging/production unless public account creation is explicitly desired. `AUTH_RATE_LIMIT_MAX` and `RESPONDENT_RATE_LIMIT_MAX` can tune API throttling for login/register and respondent-token endpoints.

### Database bootstrap notes

- `db:setup` reads DB credentials from `api/.env.local`
- The script requires Liquibase CLI on your `PATH`
- A generated Liquibase defaults file is created at `db/.liquibase.local.generated.properties` during setup
- `db:setup` also ensures a bootstrap local admin account in `users` so login is available immediately
- Default bootstrap credentials are `admin` / `admin123`
- Override bootstrap credentials with `LOCAL_ADMIN_USERNAME` and `LOCAL_ADMIN_PASSWORD` in `api/.env.local`
- `db:setup` is local-only and refuses to run when `DB_HOST` is not local or `NODE_ENV` is non-local
- For staging/production, migrations run automatically on the EC2 instance during deploys (see `.github/workflows/deploy.yml` and `scripts/deploy/remote-deploy.sh`) — the databases are not reachable from outside the VPC
- For intentional non-local one-off execution, pass `--allow-nonlocal` (or set `ALLOW_NON_LOCAL_DB_SETUP=true` in `api/.env.local`)

## CI/CD

- `CI` workflow (every PR and push to `main`): builds and tests both frontends, and runs an API integration smoke test against a migrated Postgres 15 service container (`scripts/ci/api-smoke.sh`).
- `Deploy` workflow: pushes to `main` deploy to **staging** automatically; **production** deploys are triggered manually from the Actions tab. Frontends are synced to S3 + CloudFront invalidated; the API is packaged as a tarball in S3 and installed on the EC2 instance via SSM (`scripts/deploy/remote-deploy.sh`) with a pm2 reload — instances are never rebuilt for a deploy. The workflow now performs external smoke checks after deploy.
- `Redeploy API Artifact` workflow: manually redeploys a previously published API artifact SHA through SSM and can mark it as `latest` after the external API smoke check passes. This is an artifact redeploy, not a database/schema rollback.
- Infrastructure (environments, IAM/OIDC for CI, setup steps) is documented in [terraform/README.md](terraform/README.md). Runtime API secrets are stored in SSM Parameter Store SecureString values. Cleanup and hardening work is tracked in [plans/infra-hardening-production-readiness-plan.md](plans/infra-hardening-production-readiness-plan.md).

### Standard local ports

- API: `3000`
- Dashboard: `3001`
- Survey: `3002`

The local runner verifies that the dashboard and survey point at the same API origin and that the API CORS origins match the local frontend URLs.
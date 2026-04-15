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

### Database bootstrap notes

- `db:setup` reads DB credentials from `api/.env.local`
- The script requires Liquibase CLI on your `PATH`
- A generated Liquibase defaults file is created at `db/.liquibase.local.generated.properties` during setup
- `db:setup` also ensures a bootstrap local admin account in `users` so login is available immediately
- Default bootstrap credentials are `admin` / `admin123`
- Override bootstrap credentials with `LOCAL_ADMIN_USERNAME` and `LOCAL_ADMIN_PASSWORD` in `api/.env.local`
- `db:setup` is local-only and refuses to run when `DB_HOST` is not local or `NODE_ENV` is non-local
- For production/staging, use Terraform outputs plus generated scripts in `db/liquibase-prod.sh` or `db/liquibase-prod.ps1`
- For intentional non-local one-off execution, pass `--allow-nonlocal` (or set `ALLOW_NON_LOCAL_DB_SETUP=true` in `api/.env.local`)

### Standard local ports

- API: `3000`
- Dashboard: `3001`
- Survey: `3002`

The local runner verifies that the dashboard and survey point at the same API origin and that the API CORS origins match the local frontend URLs.
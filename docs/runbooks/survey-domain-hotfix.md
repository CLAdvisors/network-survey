# Production survey domain hotfix

## Scope

- Runtime/API base: `c1f9fa271915823a8ae32916ab899105ab1364c2`
- Canonical survey origin for new links: `https://survey.cladvisorsurveys.com`
- Retained survey origin for issued links: `https://demo.ona.survey.bennetts.work`
- Unchanged API: `https://demo.ona.api.bennetts.work`
- Unchanged dashboard: `https://demo.ona.dashboard.bennetts.work`
- No staging deployment, current-main API deployment, frontend rebuild, or database migration.

Never include respondent or demo tokens in commands, logs, screenshots, tickets, or
smoke-test URLs.

## Release artifacts

The manual `Deploy Survey Domain Hotfix` workflow packages only the API at this
production-compatible revision and uses
`scripts/deploy/remote-deploy-survey-domain-hotfix.sh`. The installer:

- fetches the reviewed runtime configuration and secrets through the existing
  production paths;
- refuses activation unless the canonical and legacy survey origins match this
  runbook;
- does not invoke Liquibase or bootstrap an account;
- does not publish either frontend;
- restores the previous on-instance release if local API activation fails.

The workflow is manual, uses the protected `production` GitHub environment, is
serialized with other production API releases, and requires the explicit
`deploy` confirmation input. Do not use the normal `Deploy` workflow for this
hotfix.

## Phase 1: additive certificate bootstrap

No full production apply is allowed in this phase.

1. Initialize the active production root and obtain a fresh plan for only
   `aws_acm_certificate.prod_survey_customer`.
2. Confirm it creates one certificate for:
   - `survey.cladvisorsurveys.com`
   - `demo.ona.survey.bennetts.work`
3. Confirm the imported `aws_acm_certificate.prod_survey` remains untouched.
4. Apply only that targeted certificate resource after production approval.
5. Read `prod_certificate_validation_records.survey_customer` and provide the
   exact CNAME record set to the Bluehost DNS operator. Secret values are not
   involved.
6. Keep all existing ACM validation and application records.
7. Wait for the new certificate to report `ISSUED`.

## Phase 2: full infrastructure/config review

This branch intentionally predates current `main`. A full plan is acceptable
only if comparison with active state proves it will not revert unrelated
infrastructure that may have been applied since the production runtime release.
Abort on any unrelated create, update, replacement, or destroy.

The approved plan must be limited to the domain hotfix and show:

- the survey CloudFront distribution retains
  `demo.ona.survey.bennetts.work` and adds
  `survey.cladvisorsurveys.com`;
- the distribution switches to the issued dual-name certificate;
- the existing distribution and S3 origin are updated in place, not replaced;
- API and dashboard domains, certificates, ALB, and CloudFront distribution are
  unchanged;
- the runtime config sets:
  - `SURVEY_URL=https://survey.cladvisorsurveys.com`
  - `SURVEY_ALLOWED_ORIGINS=https://demo.ona.survey.bennetts.work`
- no database, network, IAM, worker, webhook, logging, secret, bucket, or
  unrelated runtime configuration changes occur;
- there are no destroys.

Save the reviewed plan artifact and apply that exact plan only after approval.

## Phase 3: Bluehost application CNAME

After CloudFront has the new alias and certificate, create:

```text
Type:   CNAME
Host:   survey
Target: <terraform output survey_cloudfront_domain>
```

Do not change the root `cladvisorsurveys.com` record or the existing
`demo.ona.survey.bennetts.work` record. Wait for public DNS and TLS validation:

```sh
dig +short survey.cladvisorsurveys.com CNAME
curl -fsS -o /dev/null https://survey.cladvisorsurveys.com/
curl -fsS -o /dev/null https://demo.ona.survey.bennetts.work/
```

## Phase 4: API-only deployment

From the reviewed hotfix revision, manually run `Deploy Survey Domain Hotfix`
against the protected production environment, select `deploy`, and enter the
exact reviewed 40-character commit as `approved_sha`. The workflow refuses any
other branch or revision.

The workflow must pass all of these before it marks the artifact latest:

- production compatibility and unchanged schema/package guards;
- API test suite;
- pre-deploy API health and both survey origins;
- on-instance local API health;
- external API health;
- exact CORS headers for both survey origins.

## Phase 5: controlled acceptance

1. Generate a demo email to an approved internal recipient.
2. Confirm its visible HTML and plain link use
   `https://survey.cladvisorsurveys.com`.
3. Complete a controlled demo flow without exposing its token in evidence.
4. Open a previously issued link on
   `https://demo.ona.survey.bennetts.work` and confirm load/submission behavior.
5. Confirm dashboard and API remain on their historical hostnames.

## Rollback

Do not remove either survey alias, certificate coverage, or DNS record after the
new hostname has issued links.

If activation fails, the hotfix installer restores the previous on-instance
release and its prior runtime file automatically. Verify API health and the
legacy survey flow before any retry.

For a later operator-initiated rollback:

1. Stop generation/sending of new invitations.
2. Set `survey_link_domain=demo.ona.survey.bennetts.work` while retaining both
   CloudFront aliases. The rendered configuration must then contain:
   - `SURVEY_URL=https://demo.ona.survey.bennetts.work`
   - `SURVEY_ALLOWED_ORIGINS=https://survey.cladvisorsurveys.com`
3. Review and apply only that runtime-config change.
4. Redeploy this production-compatible hotfix artifact—not the unpatched
   historical API—so both old and newly issued links retain CORS access.
5. Keep `survey.cladvisorsurveys.com` serving the same frontend so links already
   issued on the new hostname remain valid.
6. Verify both survey origins, generated-link behavior, and API health.

No database rollback is part of this hotfix.

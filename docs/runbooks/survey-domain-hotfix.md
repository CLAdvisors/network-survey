# Production survey domain hotfix

## Scope

- Runtime/API base: `093756cb1d4efbd5c5c968f6a4124a399f7f5d2c`
- Canonical survey origin for new links: `https://survey.cladvisorsurveys.com`
- Retained survey origin for issued links: `https://demo.ona.survey.bennetts.work`
- Unchanged API: `https://demo.ona.api.bennetts.work`
- Unchanged dashboard: `https://demo.ona.dashboard.bennetts.work`
- No staging deployment, current-main API deployment, frontend rebuild, or database migration.

Never include respondent or demo tokens in commands, logs, screenshots, tickets, or
smoke-test URLs.

## Release artifacts

This combined hotfix branch is based on `prod` and includes the reviewed survey-domain release. **Do not merge it into `main`**, which is the staging/current-development line. After it is merged into `prod`, use the protected production `Deploy` workflow; the API-only procedure below remains available for pre-merge recovery.

From the exact reviewed commit,
`scripts/deploy/package-survey-domain-hotfix.sh <approved-sha>` creates a local,
checksummed artifact without contacting AWS. It refuses a dirty worktree, the
wrong branch/SHA, database/package changes, or API changes outside the reviewed
allowlist. The artifact includes the normal bootstrap-compatible layout but the
approved production procedure invokes only
`scripts/deploy/remote-deploy-survey-domain-hotfix.sh`. That installer:

- fetches the reviewed runtime configuration and secrets through the existing
  production paths;
- refuses activation unless the canonical and legacy survey origins match this
  runbook;
- does not invoke Liquibase or bootstrap an account;
- does not publish either frontend;
- restores the previous on-instance release unless local and external API,
  edge, TLS, and CORS checks all pass.

Artifact upload, SSM execution, and `latest.tar.gz` promotion are separate
production mutations and require explicit review and approval. They are not
performed merely by pushing or reviewing this branch.

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

1. Check out the exact reviewed commit on `hotfix/prod-combined-domain-email` and run:

   ```sh
   scripts/deploy/package-survey-domain-hotfix.sh <approved-40-character-sha>
   ```

2. Review the artifact contents and recorded SHA-256 checksum.
3. Under the existing production release lock and protected AWS operator role,
   resolve exactly one `Environment=prod,App=ona-artifacts` bucket and one
   running `Environment=prod,App=ona-api` instance.
4. Upload the immutable artifact as `api/<approved-sha>.tar.gz`.
5. Use SSM `AWS-RunShellScript` to download/extract that exact object and invoke:

   ```sh
   bash deploy/remote-deploy-survey-domain-hotfix.sh <extracted-artifact-dir>
   ```

6. Treat a nonzero SSM result as a failed deployment; inspect diagnostics only
   on-instance. The installer restores the prior release unless all local and
   external checks pass.
7. Only after success, copy the immutable object to `api/latest.tar.gz` so a
   replacement instance receives the externally verified hotfix.

The guarded packaging and installer cover:

- production compatibility and unchanged schema/package inputs;
- API test suite;
- pre-activation canonical/legacy runtime configuration;
- on-instance local API health;
- external API health and both survey origins;
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

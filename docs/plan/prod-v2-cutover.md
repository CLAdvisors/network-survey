# Production replacement stack (prod-v2) cutover notes

Branch: `prod-fresh-stack`

Status: cutover completed. External DNS now points at replacement targets,
frontend aliases are attached to replacement CloudFront distributions, GitHub
production `TF_ENV` is set to `prod-v2`, and production deploy/smoke checks
succeeded.

## What was created

Terraform env: `terraform/envs/prod`

The replacement app stack was applied successfully while preserving:

- RDS: `network-survey-prod-postgres-v2`
- Imported ACM certs for:
  - `demo.ona.api.bennetts.work`
  - `demo.ona.dashboard.bennetts.work`
  - `demo.ona.survey.bennetts.work`

The account is currently at its VPC quota, so the replacement stack could not create another VPC. To proceed without deleting unrelated VPCs, the app stack creates fresh public subnets, route table, security groups, ALB, EC2, S3 buckets, and CloudFront distributions inside the existing prod DB VPC (`vpc-0a3c3c61ed4c7a097`).

Frontend CloudFront distributions were initially created without custom aliases because AWS does not allow the same alternate domain name on both the legacy and replacement CloudFront distributions. During cutover, the aliases were removed from legacy distributions and attached to the replacement distributions. `enable_frontend_custom_domains` now defaults to `true`.

## Applied outputs / DNS targets

External DNS is not in AWS. At cutover, update CNAMEs to:

| Host | CNAME target |
| --- | --- |
| `demo.ona.api.bennetts.work` | `network-survey-prod-v2-alb-1131853869.us-east-1.elb.amazonaws.com` |
| `demo.ona.dashboard.bennetts.work` | `d2awmr5sgbd2cb.cloudfront.net` |
| `demo.ona.survey.bennetts.work` | `d3w07tujvhshv1.cloudfront.net` |

Replacement resource discovery tag for deploy workflow while legacy resources remain: `Environment=prod-v2`.

Before using the production GitHub deploy workflow for the replacement stack, set the GitHub **production** environment variable:

```text
TF_ENV=prod-v2
```

Do this during/after DNS cutover. Until then, the workflow's external smoke checks still use the `demo.ona.*` hostnames and may validate the legacy stack instead of the replacement stack.

## Runtime/deploy resources

- Backend instance: `i-065f1e1f497ab1481`
- Config bucket: `ona-prod-v2-config-5vqe99`
- API artifacts bucket: `ona-prod-v2-artifacts-5vqe99`
- Dashboard bucket: `ona-prod-v2-dashboard-860d1d6d`
- Survey bucket: `ona-prod-v2-survey-860d1d6d`
- Dashboard distribution: `E90UP9NA7B0HR`
- Survey distribution: `EC32RCI72OMHZ`

Existing production SSM Parameter Store paths are reused:

- `/network-survey/prod/db/password`
- `/network-survey/prod/api/session-secret`
- `/network-survey/prod/api/resend-api-key`

## Validation already completed

- `terraform fmt`
- `terraform validate`
- `terraform plan -var-file=prod-db.local.tfvars` showed no destroys before apply.
- `terraform apply` completed with `0 destroyed`.
- API release was manually uploaded to the new artifacts bucket and deployed through SSM.
- Liquibase reported DB already up to date: 0 changesets run, 2 previously run.
- Frontends were built and synced to the new buckets.
- Smoke tests:
  - `curl -k https://network-survey-prod-v2-alb-1131853869.us-east-1.elb.amazonaws.com/health` -> `{"status":"ok","database":"ok"}`
  - `https://d2awmr5sgbd2cb.cloudfront.net/` -> HTTP 200
  - `https://d3w07tujvhshv1.cloudfront.net/` -> HTTP 200

## Completed cutover steps

1. Confirmed no final user traffic needs the legacy demo stack.
2. Removed alternate domain aliases from legacy CloudFront distributions:
   - `demo.ona.dashboard.bennetts.work`
   - `demo.ona.survey.bennetts.work`
3. Applied `terraform/envs/prod` with frontend custom domains enabled to attach the imported ACM certs and aliases to the replacement CloudFront distributions.
4. Updated external DNS CNAMEs to the targets above.
5. Set GitHub production environment variable `TF_ENV=prod-v2` so future production deploys target the replacement stack.
6. Smoke tested the public hostnames:
   - `https://demo.ona.api.bennetts.work/health`
   - `https://demo.ona.dashboard.bennetts.work/`
   - `https://demo.ona.survey.bennetts.work/`
7. After a soak period, plan legacy cleanup separately. Do not destroy `network-survey-prod-postgres-v2` or the imported ACM certs.

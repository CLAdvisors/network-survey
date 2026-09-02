# prod-secondary buildout record

**Status:** target foundation and AWS default-domain public endpoints deployed and verified; custom DNS deferred
**Target:** AWS account `710054969994`, `us-east-1`
**Source isolation:** accounts `438465164125` staging/production are not Terraform providers, backends, or resource targets for this root

This record tracks implementation authorized after the decisions in [`secondary-production-account-onboarding.md`](secondary-production-account-onboarding.md).

## Approved decisions

- long-running parallel production, no source cutover
- `us-east-1`
- fresh empty database plus synthetic validation data; no source data transfer
- AWS endpoints first; custom DNS deferred
- two-AZ ASG capacity two and Multi-AZ RDS
- VPC endpoints plus controlled per-AZ NAT egress
- target-only S3 native state locking with a customer-managed KMS key
- one protected GitHub environment named `prod-secondary`
- RDS-managed master credential plus target-only SSM runtime secrets
- rehearsed immutable release SHA
- one-time CLA owner bootstrap with a target-only password
- shared Resend team later, but no target key or webhook registration during bootstrap
- 24x7 alarm design, `$500/month` budget, 35-day RDS backups, quarterly restore drill
- cross-account backup destination deferred

## Created target-account baseline

Bootstrap resources are target-only:

- account-level S3 public access block and EBS default encryption
- versioned KMS-encrypted state bucket `network-survey-terraform-state-710054969994`
- versioned audit bucket `network-survey-audit-710054969994`
- multi-region CloudTrail with log validation
- AWS Config recorder, GuardDuty, Security Hub, and IAM Access Analyzer
- `$500/month` budget with forecast/actual notifications
- GitHub OIDC provider and target-only plan/apply/deploy roles

The workload root is `terraform/envs/prod-secondary` with backend key `envs/prod-secondary/terraform.tfstate`. Initial reviewed applies created 97 resources with zero destroys:

- dedicated VPC `10.20.0.0/16` with public, private-app, and isolated-DB tiers across two AZs
- private ASG fixed at two instances, public ALB with no ingress CIDRs, and disabled frontend CloudFront distributions
- fresh encrypted Multi-AZ PostgreSQL RDS with RDS-managed credentials, deletion protection, `prevent_destroy`, and 35-day retention
- target KMS keys, private/versioned buckets, VPC endpoints, logs, SNS operations routing, and baseline alarms
- target-only session and one-time bootstrap SecureStrings; values were not printed or committed

No DNS, ACM certificate, Resend API key, webhook endpoint, source snapshot, source secret, or source database data was created/copied.

## Runtime deployment evidence

- immutable release `de44efeaa44e5e6a082415ca66bffdd36ede501c` is installed on both private ASG instances
- both ALB targets are healthy; local API health reports database connectivity healthy
- API, delivery worker, and webhook worker run the exact release on both instances
- migration `prod-secondary-disabled-controls-1` ran exactly once
- delivery claiming, global sending, webhook claiming/processing, suppression enforcement, webhook ingestion, and legacy delivery remain disabled
- no Resend API key or webhook secret is configured
- the approved CLA owner exists exactly once as an active organization owner and is not a platform administrator
- bootstrap was returned to false, instance access to bootstrap parameters was removed, and historical release directories containing resolved bootstrap material were removed
- Terraform reports no drift after the final apply
- direct ALB CIDR ingress remains empty; the ALB origin allows only the AWS-managed CloudFront origin-facing prefix
- API, dashboard, and survey CloudFront default-domain HTTPS endpoints are enabled with no custom aliases and return HTTP 200
- dashboard-to-API CORS preflight returns the exact dashboard origin with credentials enabled

Current AWS validation endpoints:

- API: `https://d2owhx1glow77j.cloudfront.net`
- dashboard: `https://d3tvm2yhgzair6.cloudfront.net`
- survey: `https://d1i5psy3vi3gee.cloudfront.net`

The target-only bootstrap password remains in its operator-managed SecureString for approved handoff; it is not available to the application role and was never printed or committed.

Post-build read-only verification in source account `438465164125` confirmed the existing production and staging instances remain running, both RDS instances remain available, and both public API health endpoints return healthy. No source-account mutation command or source Terraform provider/backend was used.

## GitHub environment

The protected GitHub environment `prod-secondary` is configured with required reviewer `ttenneb`. Its reviewer, self-review, wait-timer, and deployment-branch policy match the existing `production` environment. All eight target-only workflow variables are configured, including account `710054969994`, `TF_ENV=prod-secondary`, and the target plan/apply/deploy OIDC role ARNs. It contains no static AWS credentials.

## Remaining blockers

Custom production hostnames/ACM remain deferred by decision. The current CloudFront default domains are suitable for endpoint validation, but custom same-site domains should be established before relying on browser session behavior for real users. The root dependency install also reports existing package vulnerabilities, including two critical findings; triage is required before declaring the environment ready for live production traffic.

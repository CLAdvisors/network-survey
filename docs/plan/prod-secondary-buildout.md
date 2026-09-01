# prod-secondary buildout record

**Status:** implementation in progress; infrastructure dark/fenced
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

## Runtime activation sequence

1. Merge/record an immutable SHA containing exact `prod-secondary` namespace controls and RDS-managed-secret support.
2. Package and upload that artifact using the explicitly authorized target bootstrap profile.
3. Apply the saved target-only NAT/runtime plan. ASG refresh uses ELB health and cannot complete on a failed application bootstrap.
4. Verify both instances through SSM, target health, exact-release API/worker heartbeats, and disabled durable controls.
5. Temporarily enable the one-time owner bootstrap, redeploy, verify the owner, then disable bootstrap and remove its runtime IAM access.
6. Keep ALB ingress empty and CloudFront disabled until the separate certificate/access activation.

## Current blocker

The authenticated `gh` identity lacks repository administration permission. Creation/protection of the `prod-secondary` GitHub environment returned HTTP 403. A repository administrator must create it with the current production reviewer and configure:

- `AWS_ACCOUNT_ID=710054969994`
- `AWS_REGION=us-east-1`
- `TF_ENV=prod-secondary`
- `API_ASG_NAME=network-survey-prod-secondary-app`
- `AWS_RESOURCE_TAGGING_REGION=us-east-1`
- `AWS_TERRAFORM_PLAN_ROLE_ARN=arn:aws:iam::710054969994:role/network-survey-prod-secondary-terraform-plan`
- `AWS_TERRAFORM_ROLE_ARN=arn:aws:iam::710054969994:role/network-survey-prod-secondary-terraform-apply`
- `AWS_DEPLOY_ROLE_ARN=arn:aws:iam::710054969994:role/network-survey-prod-secondary-deploy`

Do not configure source-account role ARNs or `TF_ENV=prod` in this environment.

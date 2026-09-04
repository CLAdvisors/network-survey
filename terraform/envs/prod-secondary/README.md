# prod-secondary Terraform root

This root is authorized only for AWS account `710054969994` in `us-east-1` and uses the exact machine environment ID `prod-secondary`.

## State prerequisite

The backend is deliberately independent from source production:

- bucket: `network-survey-terraform-state-710054969994`
- key: `envs/prod-secondary/terraform.tfstate`
- S3 native lockfile: enabled
- KMS alias: `alias/network-survey-prod-secondary-state`

The target-owned bucket and CMK were bootstrapped before initialization. This workload root does not create its own backend and must never reference the source account.

## Fixed safety posture

- provider allow-list and module preconditions enforce account `710054969994` / `us-east-1`
- every managed resource receives `Environment=prod-secondary`; no target resource receives `Environment=prod`
- VPC uses public ALB, private app, and isolated DB tiers across two AZs
- private app subnets have S3/interface endpoints and one per-AZ NAT route for controlled bootstrap/provider egress
- ASG steady-state capacity is `min=desired=2` with `max=3` for one rolling-refresh surge; instances have no public IP or SSH ingress
- the launch template requires an explicitly pinned reviewed AMI; replacement bootstrap uses bounded deterministic Ubuntu mirror fallback and opens ALB host-firewall access only after a healthy capability-verified release
- randomized Ubuntu apt timers are temporarily replaced by bounded AZ-staggered security maintenance pending the baked-AMI rollout
- RDS is fresh/empty, encrypted, Multi-AZ, deletion-protected, `prevent_destroy`, and retains automated backups for 35 days
- RDS generates and manages its master password in Secrets Manager under a target CMK
- direct ALB CIDR ingress remains empty; the enabled API CloudFront distribution reaches the ALB only through AWS's managed CloudFront origin-facing prefix list
- API, dashboard, and survey use CloudFront with validated ACM aliases under `cladvisorsurveys.com`; default domains remain available during the transition window
- no DNS or Resend provider resource is created; target-only Resend SecureStrings are operator-managed at fixed `/network-survey/prod-secondary/resend/*` paths
- runtime fixes the isolated scope, `cladvisorsurveys.com` sender, and Reply-To; credential loading and webhook ingestion are independent Terraform gates that default off
- runtime config hard-codes delivery, claiming, sending, webhook processing, bootstrap, and cutover gates off

## Current build state

The target backend, account governance, network, private two-instance ASG, Multi-AZ RDS, encrypted storage, disabled CloudFront distributions, fenced ALB, logs, alarms, and deploy roles have been created in account `710054969994`. The launch template installs the application runtime through per-AZ NAT egress and requires a capability-verified artifact from the target bucket. Bootstrap and scheduled host maintenance are bounded and observable as described in [`../../../docs/runbooks/prod-secondary-host-bootstrap.md`](../../../docs/runbooks/prod-secondary-host-bootstrap.md). Runtime resolves the RDS-managed secret transiently. Resend credential loading and ingestion remain disabled by default; exact target-only parameter permissions are granted only when their corresponding gate is enabled.

Direct public ALB ingress, Resend provider registration/key values, and production data remain deliberately absent. See `../../../docs/runbooks/prod-secondary-resend.md` for the separately approved provider and secret preparation sequence. Custom DNS and ACM are active for `api.cladvisorsurveys.com`, `dashboard.cladvisorsurveys.com`, and `surveys.cladvisorsurveys.com`. The protected GitHub `prod-secondary` environment and target-only OIDC variables are configured.

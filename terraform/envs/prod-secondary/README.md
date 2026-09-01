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
- ASG capacity is fixed at `2/2/2`; instances have no public IP or SSH ingress
- RDS is fresh/empty, encrypted, Multi-AZ, deletion-protected, `prevent_destroy`, and retains automated backups for 35 days
- RDS generates and manages its master password in Secrets Manager under a target CMK
- ALB ingress is empty by default; validation access requires both reviewed CIDRs and a target ACM certificate
- dashboard and survey CloudFront distributions are disabled and have no aliases
- no DNS, Resend credential/webhook, source data, or source account reference is created; target-only session/bootstrap SecureStrings are operator-managed
- runtime config hard-codes delivery, claiming, sending, webhook, bootstrap, cutover, and public-traffic gates off

## Current build state

The target backend, account governance, network, private two-instance ASG, Multi-AZ RDS, encrypted storage, disabled CloudFront distributions, fenced ALB, logs, alarms, and deploy roles have been created in account `710054969994`. The launch template installs the application runtime through per-AZ NAT egress and bootstraps only a capability-verified artifact from the target bucket. Runtime resolves the RDS-managed secret transiently and allows no Resend key while all provider controls remain disabled.

Custom DNS, certificates, public ALB ingress, CloudFront activation, Resend registration/key, and production data remain deliberately absent. GitHub environment creation is separately blocked until a repository administrator creates/protects `prod-secondary` and configures the documented environment variables.

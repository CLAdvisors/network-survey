# Target-account staging root (`terraform/envs/staging-target`)

Isolated **staging** instance of the shared `prod_secondary_platform` module,
running in the target account **710054969994 / us-east-1** with the logical
environment id `staging`. This root is deliberately separate from the legacy
source-account root `terraform/envs/staging` (account 438465164125), whose files
and state are preserved unchanged and must never be reused or migrated here.

| | Legacy source root | This target root |
|---|---|---|
| Path | `terraform/envs/staging` | `terraform/envs/staging-target` |
| State bucket/key | `network-survey-terraform-state-438465164125` / `envs/staging/terraform.tfstate` | `network-survey-terraform-state-710054969994` / `envs/staging-target/terraform.tfstate` |
| Provider account | source 438465164125 | target 710054969994 |
| Status | retiring (deploy frozen) | **not provisioned; no live route** |

## Networking and cost shape

- One NAT gateway carries AWS-service egress; both private app route tables use it.
- Interface VPC endpoints are **disabled** (`enable_interface_endpoints = false`), the largest cost lever.
- The **S3 gateway endpoint is retained**, and the private app/DB, SG, IAM and managed-secret boundaries are unchanged.
- Public-IP, SSH, DB and ALB restrictions are unchanged; the ALB keeps empty CIDR ingress.

## Stage 0 (this tranche): zero hosts

`start_staging_app = false` fixes ASG `min = desired = max = 0`. There is no
autoscaling policy or scheduled action that can raise capacity, and the ASG
`instance_refresh` block only maintains the desired count, so the zero ceiling
holds. Provider, sending, webhook, bootstrap and delivery feature gates are all
`false`.

Do **not** set `start_staging_app = true` until the separately approved
pre-start gates exist: the secure staging runtime integration, one reviewed
capability-verified artifact, and the AWS-only session SecureString. Those are
mandatory later work, not part of this code-only tranche.

## Bootstrap-independent inputs

`ami_id` is supplied by the protected GitHub `staging` environment. No apply,
plan against live state, or backend init is part of this tranche; see
`docs/runbooks/staging-target-freeze.md`.

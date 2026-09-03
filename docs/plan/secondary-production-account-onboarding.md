# Secondary production account: onboarding and decision record

**Status:** decisions approved; target-only implementation tracked in [`prod-secondary-buildout.md`](prod-secondary-buildout.md)
**Repository baseline:** `origin/main` / `11f3b4b094a3b483f6690fb1e58fd0bdb707a80c`
**Source account (must remain untouched):** `438465164125`, CLI profile `admin-cli`
**Target account:** `710054969994`, CLI profile `admin-710054969994`
**Discovery date:** 2026-09-01
**Decision owner:** stakeholders named during implementation authorization

This is the authoritative onboarding and pre-implementation decision record for a possible secondary production environment. It does not authorize Terraform, AWS, GitHub, DNS, Resend, or database changes. Production data transfer is a separate approval-gated track.

## 1. Safety boundary and evidence method

The hosted source production/demo application is product-inactive/work-in-progress during the infrastructure refactor, but its database remains valuable and protected. Technically running endpoints and infrastructure are not permission to alter them.

Discovery followed these constraints:

- Every AWS CLI command used an explicit profile.
- Target phases began with STS and asserted account `710054969994`; source comparisons began with STS using `admin-cli` and asserted `438465164125`.
- AWS queries returned only aggregate/resource metadata. No state object, S3 object, secret value, SecureString value, database row, email/provider data, respondent PII, bearer token, or credential was read.
- No Terraform `init`, `plan`, `apply`, import, state, or locking command was run.
- GitHub and public DNS checks were metadata-only.
- Five bounded read-only reviews covered target baseline/security, source architecture/deploy, database/data residency, DNS/TLS/network, and an independent adversarial pass.

“Absent” below means absent from the specifically queried service/region/scope, not proven absent everywhere. Evidence is labeled by account and region.

## 2. Executive recommendation

Build nothing until the blocking decisions in section 11 are approved. The recommended baseline is:

1. Treat `710054969994` as an independent security, identity, billing, state, and runtime boundary; never reuse source credentials, state, OIDC roles, KMS keys, secrets, or hostnames.
2. Use the single machine identifier **`prod-secondary`** everywhere. Do not tag any target resource `Environment=prod`.
3. Start with an **empty database created by migrations** and synthetic/non-sensitive validation data. Keep production-data transfer as a separate project.
4. Use a dedicated VPC across two Availability Zones: public ALB subnets, private application subnets, and isolated database subnets. Start with an ASG desired capacity of one and Single-AZ RDS only if the environment remains non-live/WIP; require an explicit HA activation decision before real traffic.
5. Keep every outbound/product activation gate off. Do not provision a usable Resend credential or webhook registration during infrastructure bootstrap.
6. Use distinct secondary hostnames. Existing source aliases and tokenized links remain attached to source.
7. Bootstrap an independently encrypted and locked Terraform backend, target-account GitHub OIDC roles, security telemetry, backup policy, and budget controls before workload infrastructure.
8. Prefer `us-east-1` only when stakeholders confirm there is no EU residency requirement. Prefer Frankfurt when an applicable contract/privacy decision requires EU hosting, accepting the additional release, certificate, latency, and future migration complexity.

## 3. Discovered facts

### 3.1 Source account `438465164125`, `us-east-1`

#### Terraform ownership and state contract

- Active roots are `terraform/envs/staging` and `terraform/envs/prod`.
- Active backend keys are `envs/staging/terraform.tfstate` and `envs/prod/terraform.tfstate` in `network-survey-terraform-state-438465164125`.
- The source state bucket is in `us-east-1`, versioned, encrypted with S3-managed AES-256, and has all four bucket public-access-block settings enabled.
- The backend uses S3 native lockfiles. A DynamoDB table exists as historical compatibility, but the current backend block does not use it.
- The legacy `terraform/` root is intentionally blocked unless a reviewed rollback override is supplied. It must not be adapted into a second account.
- The active production root owns the complete replacement application stack, replacement RDS, and protected/imported certificates. Older planning documents that describe DB-only/transitional ownership or the old `prod-db/terraform.tfstate` key are historical and conflict with the current root/README/live metadata.

#### Running architecture

| Layer | Read-only source evidence (`438465164125`, `us-east-1`) |
|---|---|
| VPC | `vpc-0a3c3c61ed4c7a097`, `10.0.0.0/16` |
| Network | Two replacement public subnets (`10.0.10.0/24`, `10.0.11.0/24`) route to an IGW. Existing DB-subnet-group subnets also have IGW routing; RDS itself is not public. No NAT was found in this VPC. |
| API compute | One running `t3.micro`, `i-065f1e1f497ab1481`, tagged `Environment=prod`, `App=ona-api`, with a public IP. It is a standalone instance, not an ASG member. No matching ASG was found. |
| Load balancing | Internet-facing `network-survey-prod-v2-alb` across two subnets; deletion protection enabled; access logging disabled. Target `i-065f1e1f497ab1481:3000` was healthy. |
| Database | `network-survey-prod-postgres-v2`, PostgreSQL 15.18, `db.t3.micro`, Single-AZ, encrypted, private, deletion-protected, seven-day automated backups, Terraform `prevent_destroy`. |
| Static frontends | Private/versioned/encrypted S3 buckets behind CloudFront OAC for dashboard and survey. Both distributions were enabled/deployed. |
| Runtime/deploy storage | Separate versioned/encrypted/private config and immutable artifact buckets. Runtime config is an S3 object; runtime secret values are resolved from SSM on the host. |
| TLS | Regional ACM for the ALB and `us-east-1` ACM for CloudFront. Protected certificates depend on external DNS validation. |
| DNS | Not Route 53. Public DNS currently points the API to the source ALB and dashboard/survey hosts to source CloudFront. `bennetts.work` uses Name.com nameservers; `cladvisorsurveys.com` uses Bluehost nameservers. Change authority remains unknown. |
| IAM/CI | GitHub OIDC provider and `github-actions-deploy` / `github-actions-terraform` roles exist in source. Ownership is intentionally manual today. |
| Secrets | Names-only metadata confirms SecureStrings under `/network-survey/prod/`, including DB, session, Resend, and bootstrap paths. No values were read. |
| Observability | Current code declares three production log groups, an SNS topic, optional webhook alarms, and a CloudWatch Agent SSM association. Live metadata showed staging log groups but no `/network-survey/prod/*` log groups, matching production alarms, or production topic/association. Treat production observability as unapplied/drifted until separately reconciled. |
| Backups | The active DB has encrypted automated backups and at least two available manual safety snapshots. Snapshot contents were not inspected. |

Source hardening gaps that should not be copied include the public API instance, no ASG, Single-AZ database, broad egress, no ALB access logs, and incomplete live production observability.

#### Deployment and capability fencing

- GitHub `Deploy` uses environment `staging` on pushes to `main` and `production` for manually selected production deploys.
- Production defaults map GitHub `production` to AWS tag `Environment=prod` and current source hostnames.
- Discovery fails unless it finds exactly one running API instance and exactly one tagged artifacts bucket, dashboard bucket, survey bucket, and each CloudFront distribution. This prevents ambiguous deployment but is incompatible with an ASG desired capacity greater than one without workflow redesign.
- API releases are immutable SHA artifacts uploaded to S3 and installed through SSM. Deploy runs Liquibase before activation, validates release capabilities, reloads API plus delivery/webhook workers together, checks exact-release heartbeats, then performs external smoke checks.
- `latest-compatible.tar.gz` is promoted after on-instance API/worker verification but before frontend publication and external smoke checks. `latest.tar.gz` waits for external smoke checks. Rollback refuses an artifact below the durable capability floor.
- Terraform apply and production release operations serialize through a shared concurrency group for the source environment.

#### Default-off application/provider controls

Repository defaults are fail-closed, but a copied database may contain different durable control state:

- `SURVEY_DELIVERY_V2_ENABLED=false`
- `LEGACY_START_ENABLED=false`
- `RESEND_WEBHOOK_INGEST_ENABLED=false`
- CLA one-time cutover and owner bootstrap flags false
- database controls independently gate delivery claiming, all application sending, webhook processing, and suppression enforcement
- provider webhook registration is a separate operator process and must not be Terraform-managed because its secret must not enter state

A normal deployment can restore controls that were enabled before its release handoff. Therefore infrastructure flags alone are insufficient protection for a copied database.

### 3.2 Existing GitHub `production` versus `prod` split

This split is historical, not two production stacks:

- **`production`** is the human-facing GitHub environment used by application deploy and artifact rollback. Live GitHub metadata shows required reviewers.
- **`prod`** is the machine/Terraform environment: active Terraform root suffix, backend key suffix, AWS `Environment` tag, SSM namespace, and Terraform Plan/Apply workflow choice. Live GitHub metadata shows no protection rules on `prod`.
- Workflows explicitly translate `production -> prod` for source deployment discovery.

Risk: infrastructure applies currently use the unprotected GitHub `prod` environment while releases use protected `production`. A future source-account change should reconcile that protection gap, but this project must not alter source GitHub environments.

For the secondary environment, do not repeat the split: use one GitHub environment named `prod-secondary` for plan/apply/deploy/redeploy, with required reviewers and branch/tag policy.

### 3.3 Target account `710054969994`

#### Workload and conflict inventory

| Scope | Read-only target evidence |
|---|---|
| `us-east-1` | Default VPC `172.31.0.0/16` with six default public subnets. No queried EC2, ASG, ALB/NLB, RDS, NAT gateway, ACM certificate, application SSM parameter, CloudWatch log group/alarm, or customer KMS alias. |
| `eu-central-1` | Default VPC `172.31.0.0/16` with three default public subnets. No queried EC2, ASG, ALB/NLB, RDS, NAT gateway, ACM certificate, application SSM parameter, CloudWatch log group/alarm, or customer KMS alias. |
| Global | No queried S3 bucket, CloudFront distribution, Route 53 hosted zone, GitHub OIDC provider, matching application/CI IAM role, or budget. |
| State backend | No existing bucket/table/key candidate was found. Bucket-name global availability remains unverified until an authorized bootstrap phase. |
| Backups | No target RDS instances/clusters/manual snapshots or AWS Backup plan/vault were found in the two candidate regions. |

The default CIDR overlaps between target regions and may overlap other future networks. Do not use a default VPC for this environment. The proposed CIDR must also avoid source production `10.0.0.0/16`; final enterprise/partner network overlap remains unverified.

#### Security/governance baseline

Read-only checks found:

- no customer CloudTrail trail
- no AWS Config recorder
- no GuardDuty detector
- Security Hub not subscribed
- no IAM Access Analyzer
- no account-level S3 public access block
- EBS encryption by default disabled in both candidate regions
- no customer-managed KMS key/alias found
- no budget
- no AWS Organizations membership observed
- a very small IAM footprint, but root credential hygiene, recovery ownership, support plan, alternate contacts, and credential age were not inspected

Do not enable these controls during discovery. They are bootstrap prerequisites for stakeholder-approved implementation, not evidence that the account is unsafe to inspect.

#### Quotas

Queried defaults include five VPCs/region, five NAT gateways/AZ, five regional NAT gateways/VPC, forty RDS instances, and a low standard On-Demand EC2 vCPU quota reported as five. A small initial stack fits conceptually, but instance-family availability, ALB/CloudFront/ACM, EIP, email, and exact ASG headroom must be rechecked in the selected region before an approved plan.

#### Unverified scope

Workload absence outside `us-east-1`, `eu-central-1`, and a limited Resource Explorer view is unverified. SCPs, organization guardrails, account contacts, support, DNS-provider access, GitHub owners/reviewers, billing alert delivery, and downstream network peering plans are also unknown.

## 4. Non-ambiguous naming and identity contract

**Canonical machine environment ID: `prod-secondary`.** It is immutable after backend/OIDC bootstrap. Never use `prod`, `production`, `prod-v2`, `secondary-production`, or `secondary-prod` as alternate machine values.

| Surface | Contract |
|---|---|
| AWS account | `710054969994` only |
| GitHub environment | `prod-secondary` (same environment for Terraform and release workflows) |
| AWS `Environment` tag | `prod-secondary` |
| Other required tags | `Project=network-survey`, `Stack=prod-secondary-v1`, `ManagedBy=terraform`, `AccountRole=prod-secondary`, plus `App` where discovery needs it |
| Terraform root | `terraform/envs/prod-secondary` |
| Backend bucket candidate | `network-survey-terraform-state-710054969994` (availability unverified) |
| Backend key | `envs/prod-secondary/terraform.tfstate` |
| Lock object | S3 native lockfile for that key |
| Terraform concurrency | `terraform-prod-secondary` |
| Release concurrency | `api-release-prod-secondary` |
| Resource prefix | `network-survey-prod-secondary-*` |
| SSM prefix | `/network-survey/prod-secondary/` |
| Runtime logs | `/network-survey/prod-secondary/{api,email-worker,webhook-worker}` |
| Alarm/SNS prefix | `network-survey-prod-secondary-*` |
| Artifact/config/frontends | Account-qualified globally unique buckets carrying `Environment=prod-secondary` and exact `App` tags |
| Database control environment | `prod-secondary` (requires validation/code changes; must not reuse the durable `prod` row) |
| Provider tag-safe environment | `prod_secondary` only where provider syntax disallows hyphens; map explicitly and test it |
| Candidate API hostname | `prod-secondary.ona.api.bennetts.work` |
| Candidate dashboard hostname | `prod-secondary.ona.dashboard.bennetts.work` |
| Candidate survey hostname | `prod-secondary.ona.survey.bennetts.work` or a separately approved CLA-owned hostname |

Hostname candidates reserve no DNS rights and are not approved. Current source names and all retained survey aliases remain source-only.

### Discovery isolation invariant

The existing source workflow must continue to assume a role in `438465164125` and search only `Environment=prod`. The new workflow must assume an account-local role in `710054969994`, assert that account ID, and search only `Environment=prod-secondary`. Target resources must never carry `Environment=prod`, even temporarily. This guarantees current source discovery cannot find a second `prod` instance; account isolation and tag isolation both have to hold.

Before using an ASG at **any** capacity, replace singleton instance discovery with explicit stack/ASG discovery plus instance-refresh/rolling deployment. Even desired capacity one can temporarily have zero or multiple running tagged instances during replacement. Do not weaken “exactly one” to “first result.”

## 5. Proposed parallel architecture

### 5.1 Account and delivery plane

```text
GitHub environment prod-secondary (review protected)
  -> target-account OIDC provider
  -> separate read-only plan, reviewed apply, and deploy roles
  -> mandatory STS account assertion (710054969994)

External DNS (manual owner approval)
  -> distinct API hostname -> regional public ALB
  -> distinct dashboard/survey hostnames -> CloudFront

Dedicated target VPC, two AZs
  public subnets: ALB, NAT only if approved
  private app subnets: ASG-managed EC2, no public IP/SSH
  isolated DB subnets: encrypted private RDS PostgreSQL

Private/versioned S3
  -> config with non-secret names/settings only
  -> immutable API artifacts
  -> dashboard and survey origins via CloudFront OAC

Account-local secrets/KMS/logs/alarms/backups/budget
```

### 5.2 Recommended component baseline

| Area | Proposed baseline |
|---|---|
| Account identity | Target-only OIDC provider and roles. Trust `repo:CLAdvisors/network-survey:environment:prod-secondary`; pin intended branch/ref and audience. No static AWS credentials. Separate plan/read, apply, and deploy permissions. |
| State | Target-only S3 bucket with versioning, account public-access block, bucket policy denying insecure transport, customer-managed KMS encryption, S3 native lockfile, access logging/audit trail, and recovery runbook. Do not place target state in the source bucket. |
| Network | New non-overlapping VPC (candidate `10.20.0.0/16`, pending enterprise overlap approval), two public ALB subnets, two private app subnets, two isolated DB subnets. No cross-account peering by default. |
| Egress | Current host deploy performs `npm ci` and therefore needs internet egress. Initial options are controlled NAT/proxy or redesigning artifacts to contain production dependencies/prebuilt images. Add S3 gateway and SSM/EC2Messages/SSMMessages/Logs/KMS interfaces where cost-effective. Resend still needs controlled internet egress if later enabled. |
| Compute | After workflow redesign, launch template + ASG desired/min/max `1/1/1` for WIP self-healing, no public IP, SSM only. Discovery must resolve the ASG and deploy safely through temporary zero/multiple-instance replacement states. Move to desired two across AZs only after rolling multi-instance fencing is proven. |
| Edge | Public two-AZ ALB, modern TLS, HTTP redirect, deletion protection, access logs, invalid-header dropping, health/5xx alarms. Decide WAF/rate limiting before external traffic. |
| Database | PostgreSQL-compatible version approved by application, encrypted with target CMK, private isolated subnets, deletion protection and Terraform `prevent_destroy`, unique final snapshots, explicit backup/maintenance windows. Single-AZ only as approved WIP default; Multi-AZ for HA production. |
| Secrets | SSM SecureString or Secrets Manager under target KMS. Terraform manages names/policies, not values. Prefer RDS-managed master credentials so plaintext does not enter Terraform state, **after** replacing the current `var.db_password` RDS input and mandatory SSM DB-password deploy contract. The prerequisite change must grant least-privilege secret read, resolve credentials transiently for Liquibase/runtime, support rotation, and prove no value reaches state/logs. Until then, this recommendation is not implementable. No source secret copying. |
| Frontends | Independent private S3 buckets, versioning/encryption/public block, CloudFront OAC, response headers, access logging/retention, distinct aliases. CloudFront viewer certificate must be in `us-east-1`. |
| API TLS | ACM certificate in the application region for the ALB. External DNS validation remains a manual dependency unless DNS ownership is deliberately migrated. |
| Observability | Dedicated API/delivery/webhook logs, finite retention, redaction rules, ALB/CloudFront logs, CloudWatch Agent or image-native collector, ALB/ASG/RDS/queue/worker alarms, target-only SNS/incident routing, dashboard/runbooks. Never log addresses, subjects, raw webhook payloads, signing headers, responses, or tokens. |
| Backups | Automated RDS backups, manual release/migration snapshots, copied-tag policy, restore manifest, quarterly restore drill recommendation. Cross-account/cross-region backup is a later decision. |
| Cost controls | Budget, forecast/actual notifications, cost-allocation tags, anomaly detection if approved, log/artifact lifecycle, quota checks. Billing recipients must be named before creation. |
| Release | Immutable SHA artifacts, capability validation, migrations from a private runner/instance, exact-account checks, saved reviewed plans, external smoke against secondary-only names, no automatic source fallback. |

### 5.3 Defense-in-depth disabled posture

The initial environment is **not allowed to send email, claim deliveries, accept/process provider webhooks, bootstrap users, run one-time data cutovers, or receive public user traffic**.

Required initial conditions:

1. `SURVEY_DELIVERY_V2_ENABLED=false` and `LEGACY_START_ENABLED=false`.
2. Durable delivery claiming false.
3. Global application email sending false.
4. `RESEND_WEBHOOK_INGEST_ENABLED=false`.
5. Webhook processing false.
6. Suppression activation/enforcement left at the fresh-schema default; never weaken an already activated latch.
7. No Resend webhook endpoint exists for the target hostname.
8. No usable Resend API key is provisioned; runtime startup must tolerate its absence while sending is disabled. If current code cannot, change the contract before deployment rather than installing a source credential.
9. No bootstrap password parameter, bootstrap identity, or bootstrap IAM permission; bootstrap flags false.
10. CLA production cutover flag false and normal migration root only.
11. DNS remains unpublished **and AWS default endpoints are fenced** until all controls are independently verified. An absent custom DNS record is not access control: an internet-facing ALB is reachable through its AWS hostname and an enabled CloudFront distribution through `*.cloudfront.net`. Use reviewed restrictive ALB ingress/listener state plus disabled distributions, edge authentication, or another tested deny-by-default mechanism; certificate/DNS status alone is insufficient.
12. Any future copied database is quarantined before the first application start, because copied durable controls, sessions, users, queues, suppressions, webhooks, and valid respondent links can defeat config-only assumptions.
13. Before any hosted deployment, extend migrations and every environment validator/operator script to support only the exact `prod-secondary` namespace. Fresh schema must seed delivery, sending, webhook, suppression, rate-budget, and related control rows disabled. Current tooling recognizes only its existing environment set and will reject or mis-handle the new namespace.

Each activation is a later separately reviewed decision; section 12 lists the gates.

## 6. Region and data-residency assessment

| Option | Benefits | Costs/risks | Recommendation |
|---|---|---|---|
| `us-east-1` | Closest parity with source; simpler module/workflow reuse; source snapshot operations stay same-region before cross-account copy; CloudFront certificate already requires a provider here. | Continues US data hosting; may fail EU/client requirements; still needs distinct target resources. | Recommended only if legal/product owners affirm US hosting is acceptable. |
| `eu-central-1` (Frankfurt) | Supports an EU-hosting objective and may reduce latency for EU users. | Does not erase historical US processing; production-data copy is an international transfer; requires regional ALB ACM plus `us-east-1` CloudFront ACM provider, explicit workflow regions, potentially higher cost, and cross-region snapshot/data-transfer steps. | Recommended when an applicable contract/privacy decision requires EU hosting. |

Region must be selected before backend, KMS, VPC, RDS, logs, backups, or secrets are created. “EU preferred” is not a complete data-residency policy: stakeholders must specify whether logs, backups, support access, CloudFront, GitHub, Resend, and disaster-recovery copies are in scope.

## 7. Database baseline and production-data transfer

### Recommended baseline: empty database

Run the complete, rehearsed normal Liquibase changelog against a fresh target DB, then use generated synthetic data. This minimizes privacy, token, email, session, data-residency, and rollback risk. Confirm the source DB’s current migration/capability floor through an approved non-data-revealing process before selecting a release baseline; repository docs do not prove current `DATABASECHANGELOG` state.

### Other options

1. **Synthetic seed only — recommended.** No source data. Best isolation; less fidelity for migration and scale behavior.
2. **Curated sanitized dataset.** Requires a written field-level specification, legal/product approval, isolated source-derived workspace, irreversible token/session/contact/response/template sanitization, k-anonymity/re-identification review where applicable, and validation before target import. A full unsanitized snapshot must not be restored into a generally reachable target merely to sanitize it later.
3. **Exact encrypted clone.** Highest fidelity and highest risk. Preserves PII, survey content, responses, credentials/hashes, sessions, queues, durable gates, webhook history, suppression state, email templates, and valid bearer links. It requires a quarantined private environment and explicit data-controller approval.
4. **Logical dump/restore.** Avoids snapshot-sharing mechanics but still processes the same sensitive data and introduces transport, consistency, credential, and logging risks. It is not automatically safer.

No production-data path is part of initial infrastructure implementation.

## 8. Cross-account RDS snapshot constraints

Read-only metadata shows the available source production manual snapshots are encrypted with the AWS-managed key `alias/aws/rds` in account `438465164125`, `us-east-1`. Their restore attribute currently names no other account.

Consequences:

- A snapshot encrypted with the AWS-managed RDS key cannot be shared cross-account.
- Automated backups are not directly the cross-account transfer artifact; an approved manual-copy workflow is needed.
- The current snapshots therefore cannot be directly restored by `710054969994`.

A future exact-clone workflow would generally require all of these **mutating source operations**, none of which is authorized now:

1. Create/approve a source customer-managed KMS key whose policy permits the narrowly scoped target principal.
2. Copy an approved source snapshot to a new manual snapshot encrypted with that customer-managed key.
3. Share only that copied snapshot with target account `710054969994` and grant the required KMS use.
4. If Frankfurt is chosen, define the supported cross-region ordering and keys; do not assume a one-step cross-account/cross-region restore.
5. In target, copy the shared snapshot into target ownership and re-encrypt with a target-managed KMS key before restore.
6. Restore under a unique identifier into private isolated subnets with no application writers, public DNS, provider credentials, or outbound mail.
7. Revoke source sharing/KMS access only after target ownership, reconciliation, and audit evidence are complete.

Before that project, confirm engine/version compatibility, parameter/option groups, snapshot size/copy time, KMS key policies/grants, legal transfer basis, source change window, expected cost, and rollback. Never modify or sanitize the live source DB. Never expose, log, rotate in place, or accidentally preserve active respondent links without a product decision.

## 9. Availability, recovery, and cost envelopes

### Recommended WIP defaults

- ASG desired one for self-healing, not HA.
- Single-AZ RDS, 7–14 day automated retention, deletion protection, final snapshot, and a tested restore manifest.
- Two-AZ network/ALB now so HA can be activated without a VPC redesign.
- RPO/RTO are **not committed** until stakeholders decide them.

Before real user traffic, decide whether to require ASG desired two, Multi-AZ RDS, multi-AZ egress, longer backup retention, cross-region/cross-account backup, and 24x7 on-call.

### Planning-only monthly ranges

These are order-of-magnitude design envelopes, not AWS quotes. They exclude taxes, support plan, Resend, DNS, data migration, engineering labor, high traffic, and incident tooling. Re-price in the selected region with the AWS calculator before approval.

| Shape | Approximate steady-state range | Main drivers |
|---|---:|---|
| Backend/state/security bootstrap only | `$5–40/month` | KMS requests, CloudTrail/Config/log volume, state storage; GuardDuty/Security Hub vary with events/resources. |
| WIP single-instance/Single-AZ workload | `$70–170/month` | Small EC2, ALB, small RDS/storage/backups, CloudFront/S3/logs, and one controlled NAT or several interface endpoints. |
| Two-AZ HA production baseline | `$200–450/month` | Two API instances, Multi-AZ RDS, two-AZ NAT/endpoints, logs/metrics/backups and edge usage. |

NAT gateways and multiple interface endpoints can dominate a small workload. Frankfurt is commonly priced differently from `us-east-1`; no region delta is asserted here. Obtain line-item estimates and budget thresholds before implementation.

## 10. Safe recommended defaults that do not need product activation

These are recommendations, not authorization to implement:

- Dedicated non-default VPC and no cross-account network path.
- `prod-secondary` naming contract and mandatory account assertions.
- Empty DB with synthetic data.
- Private app and isolated DB; SSM only; no SSH/public instance IP.
- Target-owned CMKs, state, backups, logs, and secrets.
- Deletion protection/`prevent_destroy` on DB and protected state resources.
- S3 public access blocked at account and bucket levels; versioning and lifecycle.
- One review-protected GitHub environment and independent least-privilege roles.
- All email/webhook/bootstrap/cutover/traffic gates off.
- Distinct hostnames; source aliases untouched.
- Finite log retention: 30 days for application/worker logs and raw webhook payloads unless compliance selects another value; longer immutable security/audit retention to be decided.
- Quarterly restore drill for a live environment; pre-release restore drill before any data migration.
- No decommission date until purpose and success criteria are defined; require an explicit owner and review date.

## 11. Blocking stakeholder decisions

Items 1–9 are required before account/bootstrap implementation. Items 10–16 must be recorded before their dependent workload, access, or activation phase; unresolved items retain the corresponding stop gate. Recommendations are bold.

1. **Purpose and traffic model**
   Options: (A) infrastructure rehearsal/internal validation; (B) warm/cold disaster-recovery standby; (C) eventual live parallel production; (D) migration/cutover target.
   Tradeoff: purpose determines HA, data, DNS, access, cost, and decommission. **Recommend A initially, with no public users or cutover.**

2. **Primary region and residency**
   Options: (A) `us-east-1`; (B) `eu-central-1`; (C) another region after new discovery.
   Tradeoff: source parity versus EU-hosting objective and cross-region complexity. **Recommend B only when legal/client policy requires EU hosting; otherwise A.** Name the decision maker and document scope for DB, logs, backups, CDN, Resend, and support access.

3. **Database content**
   Options: (A) empty + synthetic; (B) approved sanitized subset; (C) exact snapshot clone.
   Tradeoff: fidelity versus privacy, token/email safety, transfer complexity, and source mutation. **Recommend A.** B/C require a separate approved data-transfer plan.

4. **Hostnames, public access, and DNS ownership**
   Options: (A) no public DNS/access; (B) distinct allow-listed secondary names; (C) distinct public names; (D) eventual source-name cutover.
   **Recommend A during bootstrap, then B for controlled validation.** Identify Name.com/Bluehost owners, approval path, certificate-validation owner, TTL policy, and whether WAF/auth is required. D is a later program.

5. **Availability, RTO, and RPO**
   Options: (A) WIP ASG=1 + Single-AZ RDS; (B) ASG=2 + Multi-AZ RDS; (C) DR-specific standby objectives.
   **Recommend A while explicitly non-live, B before production traffic.** Stakeholders must state maximum outage/data loss and maintenance tolerance.

6. **Network topology and egress**
   Options: (A) controlled NAT; (B) VPC endpoints plus approved egress proxy/NAT; (C) redesign deploys around prebuilt artifacts and deny general egress.
   Current `npm ci` and future Resend calls need internet access. **Recommend B initially and plan C; prohibit public app IPs.** Confirm CIDR `10.20.0.0/16` does not overlap enterprise/partner networks.

7. **Terraform backend and encryption**
   Options: S3 native lockfile versus S3 + DynamoDB under organizational policy; target CMK versus S3-managed encryption.
   **Recommend target-only S3, versioning, native lockfile, and customer-managed KMS.** Decide break-glass/backend administrators, retention, object lock requirement, and recovery process.

8. **GitHub environment/OIDC/protection**
   Options: one `prod-secondary` environment versus repeating `production`/`prod`; branch-only versus signed-tag releases.
   **Recommend one protected `prod-secondary` environment, separate plan/apply/deploy roles, required reviewers, main or approved immutable tag, and target STS assertion.** Name reviewers and role owners.

9. **Secrets and KMS ownership**
   Options: SSM SecureString, Secrets Manager, or mixed by rotation needs.
   **Recommend RDS-managed Secrets Manager credentials plus SSM/Secrets Manager for runtime secrets, all target-owned and KMS-scoped.** Decide rotation, break-glass, and separation of duties. No source value reuse.

10. **Release and migration baseline**
    Options: current `main`, a recorded immutable release, or a compatibility release after migration rehearsal.
    **Recommend a recorded SHA proven against a fresh DB with normal master changelog and all provider gates off.** Confirm capability floor, reversible/irreversible migrations, no-op rerun, and rollback artifact.

11. **User/bootstrap access**
    Options: no dashboard user; temporary one-time owner bootstrap; invite/SSO path.
    **Recommend no user during infrastructure validation, then an approval-gated invite/SSO design.** Never copy source sessions/users. Define platform/operator versus tenant owner responsibilities.

12. **Resend/team/domain/email posture**
    Options: no credential/endpoint; separate Resend team/domain; later shared team with independent key/endpoint and aggregate rate budget.
    **Recommend no credential or webhook initially; later prefer an independently governed production provider boundary.** Confirm sender-domain ownership, endpoint capacity, account-wide suppression semantics, quotas, and test recipients before any activation.

13. **Monitoring and on-call**
    Options: business-hours owner versus 24x7 service; email, chat, or incident platform routing.
    **Recommend business-hours for WIP and named 24x7 ownership before public traffic.** Approve alarm recipients, escalation, PII redaction, dashboards, and deploy-failure routing.

14. **Backup/restore policy**
    Options: 7, 14, or 35 days; Single/Multi-AZ; target-only versus cross-account/region copies.
    **Recommend 14 days for WIP, quarterly restore tests, and a pre-migration final snapshot; choose stronger policy from RPO/compliance.** Name restore authorizer and evidence retention.

15. **Compliance and retention**
    Decide respondent/contact/response/template retention, token expiry/revocation, audit/security logs, application logs, webhook payloads, backup deletion lag, legal holds, subject deletion requests, and EU transfer basis. **Recommend data minimization and no source-derived data until policy is approved.**

16. **Cutover/no-cutover and decommission**
    Options: permanent isolated validation, DR standby, later cutover, or time-boxed experiment.
    **Recommend explicit no-cutover now.** Assign owner, success criteria, review date, cost ceiling, archival evidence, data-destruction approval, and decommission trigger. Source changes always require a separate plan.

## 12. Later activation decisions

These are intentionally not bundled with infrastructure creation:

1. Publish secondary DNS and allow user traffic.
2. Create/bootstrap a dashboard owner or enable account invites/SSO.
3. Provision a Resend credential.
4. Enable global application sending.
5. Enable durable survey delivery and claiming.
6. Create/enable a Resend webhook endpoint and ingestion.
7. Enable webhook projection.
8. Activate suppression enforcement after race/reconciliation tests.
9. Import sanitized or exact production data.
10. Raise ASG capacity to two and enable Multi-AZ RDS.
11. Add cross-account/cross-region backup or networking.
12. Perform any hostname or traffic cutover.
13. Decommission the target or any source component.

Each requires a saved plan/change artifact, named approver, preconditions, verification, abort criteria, and rollback boundary.

## 13. Phased implementation roadmap (not authorized)

### Phase 0 — decisions and account governance

**Prerequisites:** approve sections 11.1–11.9; name account, billing, security, GitHub, DNS, and incident owners.

**Proposed work:** verify root/MFA/recovery/support/contacts and organization/SCP status; establish account-level S3 block, encryption defaults, CloudTrail, Config, GuardDuty/Security Hub/Access Analyzer as approved; create budget/anomaly controls; request quota increases if needed.

**Reviewed artifacts:** account baseline checklist, ownership matrix, threat model, line-item estimate, governance Terraform plan or explicitly manual bootstrap runbook.

**Verification:** target STS assertion; security service status; alert delivery test; no workload/source identifiers.

**Abort:** wrong account, unknown owner, denied SCP, missing billing recipient, quota/cost beyond approval.

**Rollback boundary:** target governance only; no source dependencies.

### Phase 1 — state and CI identity bootstrap

**Prerequisites:** approved region, naming, KMS/state model, GitHub reviewers.

**Proposed work:** create target KMS/state bucket/locking and target OIDC/roles; create one protected `prod-secondary` GitHub environment; add mandatory account assertions.

**Reviewed artifacts:** bootstrap plan, key/bucket policies, OIDC trust, least-privilege role policies, backend recovery runbook.

**No-destroy checks:** no source account/bucket/role ARN; no wildcard environment trust; state versioning and recovery retained.

**Verification:** read-only role can identify target; plan cannot access source; locking/recovery tested with non-production fixture only.

**Abort:** any source ARN or `Environment=prod`, broad repository/ref trust, secret in output/state, unprotected apply role.

**Rollback boundary:** target bootstrap resources; preserve state/key until all dependent state versions are safely archived.

### Phase 2 — network, edge foundations, and observability

**Prerequisites:** CIDR/egress/hostname/log-retention decisions; DNS remains unpublished.

**Proposed work:** dedicated VPC/subnet tiers/routes/endpoints/NAT choice, security groups, log buckets/groups, target SNS/alarms, regional and CloudFront certificate requests only after DNS owner is ready.

**Reviewed artifacts:** network diagram, route/egress matrix, DNS/certificate record manifest, cost update, saved Terraform plan.

**No-destroy checks:** creates only in `710054969994`; no default VPC modification; no source aliases; no public app/DB route; no `Environment=prod`.

**Verification:** flow/access logs, endpoint/SSM path, TLS after manual validation, no source DNS change.

**Abort:** CIDR overlap, public DB/app instance, unapproved DNS record, source alias in plan, egress bypass, monthly estimate above ceiling.

**Rollback boundary:** target-only networking/edge; certificates and log evidence retained as policy requires.

### Phase 3 — empty database and storage

**Prerequisites:** database-content decision A, engine/release compatibility, backup/RTO/RPO policy.

**Proposed work:** target CMK, isolated subnet group, empty encrypted RDS, target secrets, private/versioned buckets and OAC distributions without public aliases.

**Reviewed artifacts:** saved plan, migration rehearsal report on disposable DB, backup/restore manifest, DB parameter diff.

**No-destroy checks:** RDS deletion protection and `prevent_destroy`; unique final snapshot; no snapshot restore/source KMS reference; no secret values in Terraform.

**Verification:** private reachability only, encryption/backup status, restore rehearsal, empty-schema migration and no-op rerun.

**Abort:** unexpected migration/data operation, plaintext secret/state, public accessibility, source snapshot/ARN, destructive plan.

**Rollback boundary:** empty target data only; preserve final snapshot before any approved DB replacement.

### Phase 4 — application platform, still dark

**Prerequisites:** immutable release SHA; deploy egress solution; singleton discovery replaced with ASG/instance-refresh-safe rolling deployment; exact `prod-secondary` support in migrations, runtime validation, rate budgets, and every operator script; fresh schema seeds every required control row disabled; current DB password/SSM contract either retained under an approved secret-value process or replaced end-to-end with RDS-managed credentials; all off-gates testable without Resend.

**Proposed work:** launch template/ASG desired one, ALB, config/artifact/frontend storage, SSM deployment, CloudWatch collection, secondary-only workflow mapping, and a reviewed access fence for ALB/CloudFront default AWS hostnames.

**Reviewed artifacts:** release capability manifest, saved Terraform plan, workflow diff, IAM policy diff, migration output without data, test evidence.

**No-destroy checks:** exact target account and `prod-secondary`; no source domains/buckets/roles/SSM paths; all gates false; no bootstrap or Resend secret; no current source workflow behavior change.

**Verification:** fresh-schema `prod-secondary` control-row manifest; every environment validator/operator command accepts exactly the new namespace and rejects aliases; API/worker health on the approved private/fenced path; ASG replacement test covers temporary zero/multiple instances without ambiguous deployment; exact SHA/heartbeats; synthetic smoke tests; controls independently false; ALB/CloudFront default hostnames deny unapproved access; no provider/DNS traffic; alarms fire to approved test route; DB credentials rotate/read transiently under the selected contract without entering Terraform state or logs.

**Abort:** missing/misnamed control row, unsupported operator script, source discovery possible, ambiguous ASG target selection, publicly reachable unfenced AWS endpoint, outbound provider call, deploy restores a gate, secret enters state/logs, migration mismatch, more than reviewed steady-state instances, health or logging failure.

**Rollback boundary:** artifact rollback only if capability-compatible; additive schema is not rolled back; DB endpoint rollback uses a separately restored target snapshot.

### Phase 5 — controlled validation and optional distinct DNS

**Prerequisites:** access/user/DNS/WAF decisions, privacy review, synthetic dataset, incident owner.

**Proposed work:** publish distinct secondary names, allow-list access, run browser/API/restore/load/security tests. Email remains off.

**Reviewed artifacts:** DNS manifest, certificate evidence, access test plan, pen-test/security checklist, cost actuals.

**Verification:** source DNS unchanged; secondary TLS/CORS/cookies isolated; token/log redaction; no source data/provider calls.

**Abort:** alias collision, source hostname response change, cross-environment cookie/token acceptance, unexpected email/webhook call, uncontrolled public access.

**Rollback boundary:** remove only secondary DNS/access after TTL; retain target infrastructure/data for analysis until approved cleanup.

### Phase 6 — optional production-data transfer project

**Prerequisites:** explicit separate authorization for source mutations/data handling; legal/privacy approval; source change window; exact method; quarantine; snapshot/KMS plan.

**Proposed work:** execute only the independently reviewed empty/sanitized/exact path. Never alter live source DB contents.

**Reviewed artifacts:** data inventory/classification, KMS/snapshot policy, sanitization specification, transfer manifest, count/digest reconciliation that exposes no PII/tokens, rollback release/snapshot.

**No-destroy checks:** source DB/snapshots preserved; only named copied snapshot/key grants; target unique identifiers; all writers, DNS, user, email, claiming, webhook, bootstrap, and egress gates off.

**Verification:** isolated restore, migration exact pending set/no-op, aggregate reconciliation, token/session policy, provider controls false before first start.

**Abort:** AWS-managed source key not remediated through approved copy, any data/secret appears in logs, unexplained reconciliation difference, writer/provider connectivity, source plan mutation beyond approved copy/share.

**Rollback boundary:** preserve failed target restore and source snapshots; restore a new target endpoint rather than overwriting either DB; revoke sharing after evidence is complete.

### Phase 7 — HA or product activation

**Prerequisites:** explicit live-service approval, production SLO/RTO/RPO, multi-instance deployment design, on-call, provider/domain decisions, successful restore/load/security drills.

**Proposed work:** ASG two, Multi-AZ DB as approved, DNS/public traffic, then each email/webhook gate one at a time under its runbook.

**Verification:** rolling deploy, AZ failure, restore, alarm/escalation, capability floor, sending rate/suppression/webhook race tests, secondary-only smoke.

**Abort:** singleton workflow still in use, stale heartbeat, missing alarm, control revision mismatch, provider quota/domain/endpoint uncertainty, rollback artifact incompatible.

**Rollback boundary:** traffic rollback keeps distinct aliases available; disable claiming/sending/provider endpoint in documented order; never reverse additive schema or overwrite databases.

### Phase 8 — review or decommission

**Prerequisites:** purpose owner decides keep/promote/decommission; legal/backup retention satisfied.

**Proposed work:** inventory, final target snapshot/export if approved, revoke GitHub/provider/DNS access, remove workload in dependency order, retain/destroy state/KMS only under a separate reviewed policy.

**Abort:** unknown data owner, unresolved legal hold, no final backup verification, shared hostname/provider dependency, active traffic.

**Rollback boundary:** DNS/identity revocation is staged before irreversible deletion; source remains untouched.

## 14. Plan review and acceptance checklist

Every future plan/change must answer “yes” before apply/deploy:

- [ ] STS proves account `710054969994`; selected region is labeled.
- [ ] No source provider alias, ARN, account ID (except an explicitly approved snapshot-sharing principal), hostname, bucket, role, SSM path, or state backend is targeted.
- [ ] No resource has `Environment=prod`; all have the required `prod-secondary` contract.
- [ ] Saved plan/change artifact was reviewed; no unreviewed auto-plan is applied.
- [ ] Destroy/replace list is empty unless each item has a named approval and backup/rollback.
- [ ] RDS/state/KMS protections and final-snapshot behavior are present.
- [ ] No secret value, state content, DB data, email data, PII, or token is in plan/output/logs.
- [ ] Email sending, claiming, delivery, webhook, suppression/bootstrap/cutover and traffic gates remain at the approved state.
- [ ] Current source deploy discovery and GitHub workflows cannot select target resources.
- [ ] Cost delta is within the approved ceiling and quota headroom remains.
- [ ] Verification, abort criteria, and rollback boundary are executable before change.

## 15. Open unknowns register

1. Final environment purpose, lifespan, owner, success criteria, and cost ceiling.
2. Region and complete data-residency/compliance scope.
3. Enterprise/partner CIDRs and future peering/Transit Gateway intent.
4. GitHub reviewer/administrator identities and desired release policy.
5. Name.com/Bluehost ownership and approved secondary hostnames.
6. Target account root/recovery/support/alternate-contact and organization/SCP posture.
7. Exact production release and database migration/capability floor.
8. The local API can start without Resend credentials, but hosted `remote-deploy.sh` currently fetches the Resend SSM parameter unconditionally; the approved hosted no-credential contract remains unresolved.
9. Whether current deployment will be redesigned to avoid runtime `npm ci` and general internet egress; ASG-safe discovery/rolling release redesign is mandatory regardless.
10. RTO/RPO, HA, backup retention, restore cadence, and cross-region/account backup.
11. Log/audit/webhook/data retention and deletion/legal-hold policy.
12. Monitoring/on-call recipients and escalation.
13. Resend team/domain/endpoint/quota/suppression ownership if email is ever activated.
14. WAF/rate-limiting and public-access requirements.
15. Whether source-derived data is needed; if yes, sanitization/exact clone and token policy.
16. Cutover/no-cutover and target/source decommission policy.

## 16. Discovery completion statement

The discovery phase performed read-only repository, AWS metadata, GitHub environment metadata, and public DNS discovery only. Its no-mutation statement was accurate when recorded. Stakeholders subsequently approved the decisions and authorized target-only implementation. Current implementation evidence, mutations, safeguards, and blockers are recorded in [`prod-secondary-buildout.md`](prod-secondary-buildout.md). Source account `438465164125` remains outside the target Terraform provider/backend and must remain untouched.

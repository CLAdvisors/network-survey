# prod-secondary platform module

This module is intentionally specific to the independently isolated `prod-secondary` stack. It refuses any other environment identifier and is paired with an account/region assertion in the environment root.

It creates:

- a dedicated VPC across two Availability Zones
- public ALB, private application, and isolated database subnet tiers
- S3 and interface endpoints plus one NAT gateway per AZ for controlled package/provider egress
- a private ASG at `min=desired=2`, `max=3` only to permit one safe rolling-refresh surge, without public IPs or SSH
- a direct-CIDR-fenced ALB whose HTTP origin accepts only the AWS-managed CloudFront origin-facing prefix when public AWS endpoints are enabled
- a fresh, deletion-protected Multi-AZ PostgreSQL database
- target-owned workload and RDS CMKs
- an RDS-managed master credential in Secrets Manager
- private/versioned config, artifact, dashboard, and survey buckets
- CloudFront HTTPS distributions for the API, dashboard, and survey with optional validated ACM aliases while retaining default-domain access
- field-selective CloudFront Standard Logging v2 for the API only, delivered as Hive-partitioned JSON to a private SSE-S3 bucket with 30-day expiration
- exact `prod-secondary` runtime configuration with an isolated Resend scope/sender/Reply-To and credential, sending, claiming, webhook, bootstrap, cutover, and traffic gates off
- target-scoped deploy IAM, runtime/host/system log groups, SNS routing, and actionable ALB/ASG/RDS/host/process alarms
- dependency-free ALB liveness for ELB replacement health, so failed bootstrap/process startup is replaced while shared database incidents cannot destroy both hosts

The launch template requires an explicit reviewed AMI ID rather than resolving a moving latest image. It installs the reviewed runtime through per-AZ NAT egress and requires a successful deployment of `latest-compatible.tar.gz` from the target artifact bucket before opening host-firewall access to ALB health checks. Bootstrap uses bounded apt/network operations with deterministic non-EC2 Ubuntu mirror fallback, emits secret-free status and alarm markers, and reruns the complete deploy contract after interruption. Ubuntu's randomized apt timers are temporarily replaced by bounded, low-priority, AZ-staggered weekly security upgrades pending the baked-AMI pipeline; see [`../../../docs/runbooks/prod-secondary-host-bootstrap.md`](../../../docs/runbooks/prod-secondary-host-bootstrap.md).

The deploy contract retrieves the RDS-managed password transiently, loads Resend secrets only when target-only gates are enabled, validates the exact target identity and parameter paths, and keeps all durable email/webhook controls disabled after fresh migration.

API edge logs intentionally omit raw paths, query strings, cookies, referrers, user agents, client/forwarded IPs, geography, and custom viewer data. Safe path attribution comes only from the API's normalized Express route-template telemetry. Raw ALB access logs remain disabled because their request line cannot exclude query strings before storage. The JSON and Hive-compatible partition path are directly queryable from Athena; a Glue catalog and Athena workgroup are intentionally deferred until recurring SQL use justifies their maintenance and query-result access surface.

The module does not create DNS, ACM certificates, provider credentials, webhook registrations, bootstrap identities, or production data. Runtime health semantics, rollout/rollback criteria, and the future one-host-at-a-time drain/patch/reboot procedure are documented in `../../../docs/runbooks/runtime-resilience.md`.

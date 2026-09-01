# prod-secondary platform module

This module is intentionally specific to the independently isolated `prod-secondary` stack. It refuses any other environment identifier and is paired with an account/region assertion in the environment root.

It creates:

- a dedicated VPC across two Availability Zones
- public ALB, private application, and isolated database subnet tiers
- S3 and interface endpoints plus one NAT gateway per AZ for controlled package/provider egress
- a private ASG fixed at `min=desired=max=2`, without public IPs or SSH
- a CIDR-fenced ALB (no ingress by default)
- a fresh, deletion-protected Multi-AZ PostgreSQL database
- target-owned workload and RDS CMKs
- an RDS-managed master credential in Secrets Manager
- private/versioned config, artifact, dashboard, and survey buckets
- disabled CloudFront distributions for the frontend AWS endpoints
- exact `prod-secondary` runtime configuration with sending, claiming, webhook, bootstrap, cutover, and traffic gates off
- target-scoped deploy IAM, runtime log groups, SNS routing, and baseline ALB/ASG/RDS alarms

The launch template installs the reviewed runtime through per-AZ NAT egress and bootstraps only `latest-compatible.tar.gz` from the target artifact bucket. The deploy contract retrieves the RDS-managed password transiently, permits an absent Resend key only for `prod-secondary`, validates the exact namespace, and keeps all durable email/webhook controls disabled after fresh migration.

The module does not create DNS, ACM certificates, provider credentials, webhook registrations, bootstrap identities, or production data.

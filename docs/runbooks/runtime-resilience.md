# Runtime resilience, health, and host maintenance

## Runtime contract

All API, delivery-worker, and webhook-worker PostgreSQL pools use bounded acquisition, client-query, server-statement, idle-transaction, and TCP-keepalive settings. Defaults are 3s acquisition, 10s client query, 9s statement, 15s idle transaction, 5s keepalive delay, and a 30-minute pooled-connection lifetime. Keep `DB_STATEMENT_TIMEOUT_MS <= DB_QUERY_TIMEOUT_MS`; raising either requires a measured query and rollback review.

Worker heartbeat and webhook maintenance jobs use completion-based scheduling. A stalled run cannot overlap its successor. Main worker loops treat bounded DB errors as degraded idle operation rather than crashing repeatedly. Delivery leases, provider-boundary records, and stable idempotency keys remain authoritative after interruption.

PM2 requires 30s minimum uptime, limits ten **consecutive pre-30s unstable starts**, and exponentially backs off from 1s. This is startup-loop containment, not a lifetime restart budget: failures after 30s reset PM2's unstable-start counter and are detected by heartbeat/restart alarms for operator action. On prod-secondary only, RSS restart tripwires are API 352 MiB and each worker 176 MiB (704 MiB aggregate). They remain unset on the smaller source-prod/staging hosts. They are containment tripwires, not reservations. The completed prod-secondary `t3.small` rollout provides 2 GiB per host, leaving substantial headroom for Ubuntu, PM2, CloudWatch Agent, page cache, and periodic PM2 polling. Do not lower them without representative survey/provider tests; do not raise them without proving host headroom.

## Health semantics

- `GET /live`: dependency-free process liveness. This is the **only ALB target health path**. A missing or event-loop-wedged process fails closed and is removed from traffic.
- `GET /ready`: bounded DB and pool readiness. DB failure or a waiting pool returns 503.
- `GET /health/dependencies`: same dependency status for operators.
- `GET /health`: backward-compatible bounded DB health used by deploy verification and singleton ALBs; unlike `/ready`, recoverable pool waiters alone do not fail it.

The prod-secondary ASG retains ELB replacement health so a host that fails bootstrap or cannot start the API is replaced. Crucially, ELB health now uses dependency-free `/live`, not DB readiness: a shared RDS/pool incident therefore cannot mark both hosts unhealthy and trigger destructive replacement. PM2 attempts bounded process recovery, and the bootstrap branch's 30-minute grace plus one-instance surge preserves recovery capacity. Never point ALB replacement health at `/ready`, `/health`, or another shared-dependency probe.

## Signals and first response

CloudWatch Agent publishes EC2 memory, swap, root disk use/free inodes and ships PM2 plus kernel logs (not broad syslog content). Application EMF publishes process starts/heartbeat/RSS, event-loop lag, DB pool active/idle/waiting, and a bounded PostgreSQL dependency result. Alarms cover host pressure, EC2 status, process telemetry loss/restart churn/RSS, event-loop lag, pool waits, direct DB dependency failure, kernel OOM/critical logs, ALB target health, ASG capacity, and RDS CPU/storage.

On alarm:

1. Keep email sending/claiming and webhook processing controls in their current safer state; do not toggle default-off controls merely to clear an alarm.
2. Correlate both hosts. A simultaneous DB/pool alarm points to RDS/network/query pressure, not host replacement.
3. Inspect `/live`, `/ready`, PM2 status/restart history, process RSS, event-loop lag, pool gauges, swap/disk/inodes, and kernel logs through approved SSM/CloudWatch paths.
4. For a single process failure, allow PM2 backoff. For a single EC2 status failure, allow ASG recovery. For shared dependency failure, preserve hosts and repair/restore the dependency.
5. Treat a delivery-worker kill after `provider_started_at` as ambiguous. Do not manually resend; let the durable idempotent retry/reconciliation path decide.

## Rollout, abort, and rollback

PRs #61 and #62 are merged, and this change is rebased onto them. The combined launch template retains compressed user data, bounded bootstrap/apt/security-update behavior, bootstrap/maintenance logs and alarms, the 30-minute health grace, one-instance surge refresh, and this change's host metrics/system logs. Apply no infrastructure from the old root production workspace.

Before any Terraform apply changes the target-group path, publish and deploy the `/live`-capable artifact to both existing hosts. The protected apply workflow mechanically compares registered targets with healthy InService ASG instances and runs the exact local `/live` contract through SSM on every target; plan/apply cannot proceed if any target is missing or incompatible. Do not bypass this preflight.

After that prerequisite, roll out one prod-secondary ASG instance at a time with outbound controls left as-is. The 45-minute instance warmup covers the 30-minute bootstrap/health grace plus a minimum 15-minute post-readiness soak before automatic refresh continuation. Require: `/live` 200, `/ready` 200, exact release, fresh worker heartbeats, no PM2 restart loop, stable RSS below warning thresholds, zero pool waiters, and no new OOM/critical logs.

Abort if either host exceeds three starts in 15 minutes, readiness remains unavailable for five minutes, pool waiters persist three minutes, RSS reaches a PM2 tripwire, any OOM occurs, delivery ambiguity rises unexpectedly, or both ALB targets become unhealthy. Leave delivery controls paused where the deploy safety flow paused them.

Application rollback is the existing capability-checked immutable artifact rollback. Prod-secondary's trusted workflow and on-host validator require the `alb_live_health` capability, and deployment verifies `/live`; an older artifact without that capability cannot be installed or promoted as replacement bootstrap. Rollback does not revert Terraform, schema, or runtime config. Never roll schema backward without its separate backup/capability procedure.

## Future drain / patch / reboot / rejoin procedure (documentation only)

This PR intentionally does **not** duplicate the merged host patch automation; the bootstrap hardening in `main` owns apt/security-update behavior. A future operator workflow should:

1. Verify two healthy targets, healthy RDS, no deploy/refresh, current backups, and adequate remaining-host capacity. Freeze deploys.
2. Select exactly one instance and enable scale-in protection. Record the ASG's `MinSize=2,DesiredCapacity=2`; temporarily run `aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$ASG" --min-size 1`, then `aws autoscaling enter-standby --instance-ids "$INSTANCE" --auto-scaling-group-name "$ASG" --should-decrement-desired-capacity`. Verify `DesiredCapacity=1`, exactly one healthy target remains, and wait the full target-group drain delay. Abort and restore `--min-size 2 --desired-capacity 2` if any assertion fails. Never deregister an InService instance directly and never drain both hosts.
3. Confirm no in-flight API requests on that target. Pause local PM2 workers gracefully and wait past the longest provider timeout/lease-sensitive operation; do not force-kill a provider-boundary attempt.
4. Run the bootstrap branch's bounded, locked security-upgrade command. Record package changes and whether `/var/run/reboot-required` exists. Abort on package-manager timeout, disk pressure, dependency outage, or if the other target degrades.
5. If required, reboot only the drained instance. Require EC2/SSM/CloudWatch recovery, bootstrap status success, PM2 stable uptime, `/live` and `/ready` success, exact release, fresh paused/expected worker heartbeats, and no OOM/critical logs.
6. Run `aws autoscaling exit-standby --instance-ids "$INSTANCE" --auto-scaling-group-name "$ASG"`, verify desired capacity returns to 2, then restore the Terraform-owned minimum with `aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$ASG" --min-size 2 --desired-capacity 2`. Wait for two healthy ALB targets and a 15-minute soak, then remove scale-in protection. Only then repeat for the other AZ.
7. If rejoin fails, keep the host out of service, preserve logs, and let a deliberate single-instance ASG replacement occur. Abort the maintenance window; never compensate by rebooting the healthy peer.

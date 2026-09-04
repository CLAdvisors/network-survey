# Runtime resilience, health, and host maintenance

## Runtime contract

All API, delivery-worker, and webhook-worker PostgreSQL pools use bounded acquisition, client-query, server-statement, idle-transaction, and TCP-keepalive settings. Defaults are 3s acquisition, 10s client query, 9s statement, 15s idle transaction, 5s keepalive delay, and a 30-minute pooled-connection lifetime. Keep `DB_STATEMENT_TIMEOUT_MS <= DB_QUERY_TIMEOUT_MS`; raising either requires a measured query and rollback review.

Worker heartbeat and webhook maintenance jobs use completion-based scheduling. A stalled run cannot overlap its successor. Main worker loops treat bounded DB errors as degraded idle operation rather than crashing repeatedly. Delivery leases, provider-boundary records, and stable idempotency keys remain authoritative after interruption.

PM2 requires 30s minimum uptime, limits an unstable process to ten restarts, and exponentially backs off from 1s. RSS restart tripwires are API 352 MiB and each worker 176 MiB (704 MiB aggregate on the current 1 GiB host). They are containment tripwires, not reservations. Do not lower them without representative survey/provider tests; do not raise them without also resizing the host or proving OS/agent headroom.

## Health semantics

- `GET /live`: dependency-free process liveness. This is the **only ALB target health path**. A missing or event-loop-wedged process fails closed and is removed from traffic.
- `GET /ready`: bounded DB and pool readiness. DB failure or a waiting pool returns 503.
- `GET /health/dependencies`: same dependency status for operators.
- `GET /health`: backward-compatible dependency health used by deploy verification.

The prod-secondary ASG uses EC2 health, not ELB health, for replacement. Therefore a shared RDS/pool incident removes no healthy hosts destructively. PM2 attempts bounded process recovery, ALB liveness removes dead processes from traffic, and alarms require an operator to diagnose persistent application-only failure. Never change ASG health back to `ELB` or point ALB checks at readiness without a reviewed, staggered replacement design.

## Signals and first response

CloudWatch Agent publishes EC2 memory, swap, root disk use/free inodes and ships PM2 plus kernel logs (not broad syslog content). Application EMF publishes process starts/heartbeat/RSS, event-loop lag, and DB pool active/idle/waiting. Alarms cover host pressure, EC2 status, process telemetry loss/restart churn/RSS, event-loop lag, pool waits, kernel OOM/critical logs, ALB target health, ASG capacity, and RDS CPU/storage.

On alarm:

1. Keep email sending/claiming and webhook processing controls in their current safer state; do not toggle default-off controls merely to clear an alarm.
2. Correlate both hosts. A simultaneous DB/pool alarm points to RDS/network/query pressure, not host replacement.
3. Inspect `/live`, `/ready`, PM2 status/restart history, process RSS, event-loop lag, pool gauges, swap/disk/inodes, and kernel logs through approved SSM/CloudWatch paths.
4. For a single process failure, allow PM2 backoff. For a single EC2 status failure, allow ASG recovery. For shared dependency failure, preserve hosts and repair/restore the dependency.
5. Treat a delivery-worker kill after `provider_started_at` as ambiguous. Do not manually resend; let the durable idempotent retry/reconciliation path decide.

## Rollout, abort, and rollback

Sequence this change after rebasing onto `fix/prod-secondary-bootstrap-hardening` so its bounded bootstrap/apt/security-update work remains authoritative. Resolve the shared CloudWatch cloud-init block by retaining both that branch's bootstrap/maintenance logs and this change's host metrics/system logs. Apply no infrastructure from the old root production workspace.

Roll out one prod-secondary ASG instance at a time with outbound controls left as-is. Before continuing, require: `/live` 200, `/ready` 200, exact release, fresh worker heartbeats, no PM2 restart loop, stable RSS below warning thresholds, zero pool waiters, and no new OOM/critical logs. Then observe at least 15 minutes before the second host.

Abort if either host exceeds three starts in 15 minutes, readiness remains unavailable for five minutes, pool waiters persist three minutes, RSS reaches a PM2 tripwire, any OOM occurs, delivery ambiguity rises unexpectedly, or both ALB targets become unhealthy. Leave delivery controls paused where the deploy safety flow paused them.

Application rollback is the existing capability-checked immutable artifact rollback. It does not revert Terraform, schema, or runtime config. Infrastructure rollback restores the prior target-group path and ASG health settings only if doing so cannot reintroduce DB-coupled mass replacement; normally retain `/live` + EC2 health and revert alarms/agent config independently. Never roll schema backward without its separate backup/capability procedure.

## Future drain / patch / reboot / rejoin procedure (documentation only)

This PR intentionally does **not** implement host patch automation; the bootstrap-hardening branch owns apt/security-update behavior. A future operator workflow should:

1. Verify two healthy targets, healthy RDS, no deploy/refresh, current backups, and adequate remaining-host capacity. Freeze deploys.
2. Select exactly one instance and enable ASG scale-in protection. Put it in `Standby` **with desired capacity unchanged** so a replacement is available, or deregister it and wait the full target-group drain delay. Never drain both hosts.
3. Confirm no in-flight API requests on that target. Pause local PM2 workers gracefully and wait past the longest provider timeout/lease-sensitive operation; do not force-kill a provider-boundary attempt.
4. Run the bootstrap branch's bounded, locked security-upgrade command. Record package changes and whether `/var/run/reboot-required` exists. Abort on package-manager timeout, disk pressure, dependency outage, or if the other target degrades.
5. If required, reboot only the drained instance. Require EC2/SSM/CloudWatch recovery, bootstrap status success, PM2 stable uptime, `/live` and `/ready` success, exact release, fresh paused/expected worker heartbeats, and no OOM/critical logs.
6. Re-register/exit standby, wait for ALB healthy status and a 15-minute soak, then remove scale-in protection. Only then repeat for the other AZ.
7. If rejoin fails, keep the host out of service, preserve logs, and let a deliberate single-instance ASG replacement occur. Abort the maintenance window; never compensate by rebooting the healthy peer.

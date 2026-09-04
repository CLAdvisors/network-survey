# prod-secondary host bootstrap and maintenance

This runbook applies only to the private `prod-secondary` ASG. It does not change its private-subnet, SSM-only, security-group, secret-loading, or capability-verified release contracts.

## Why this exists

On 2026-09-04 both original API targets became unhealthy and the ASG repeatedly replaced them. Replacement cloud-init downloads from `us-east-1.ec2.archive.ubuntu.com` remained incomplete for 20–40+ minutes, longer than the 1,200-second ELB health grace period. No replacement reached `REVISION` or started the API. Switching to `archive.ubuntu.com` let bootstrap reach API health in about 140–160 seconds.

Console and metric evidence also supports, but does not prove, an initiating-failure hypothesis: both original hosts had sustained 75–83% CPU beginning in the window selected by Ubuntu's randomized `apt-daily-upgrade.timer`; termination waited roughly two minutes for `Unattended Upgrades Shutdown`; ALB requests timed out; and there was no observed kernel panic, OOM kill, filesystem error, EC2 status-check failure, or RDS failure. The deleted root volumes' apt journals were not shipped, so this remains a strong hypothesis rather than a conclusive root cause.

This hardening makes replacement recovery and host patching bounded and observable. It does **not** claim to fix any other cause of the original API health loss.

## Bootstrap contract

The launch template now:

- masks Ubuntu's randomized `apt-daily` and `apt-daily-upgrade` timers before package work;
- rewrites only Ubuntu archive source URLs and tries `archive.ubuntu.com`, then `us.archive.ubuntu.com`; the EC2 regional mirror is never selected;
- applies apt retries plus connect/read timeouts and wraps update/install operations in process deadlines;
- repairs interrupted dpkg configuration before each retry, uses atomic temporary downloads, and tolerates a clean rerun;
- bounds each external network operation and uses a 30-minute ASG health-grace/readiness deadline; the extra grace is a safety margin, not the mirror fix, and planned refreshes retain both old healthy targets for the full warmup;
- enables the host firewall with port 3000 closed before provisioning and opens it only after the capability-verified `latest-compatible.tar.gz` completes the full `remote-deploy.sh` API/worker/control contract;
- always reruns the idempotent deploy contract after interruption and records an atomic deployed-revision marker only after full success; a host-level deployment lock serializes bootstrap, CI, rollback, and operator deployments;
- writes a secret-free state marker to `/var/lib/ona-bootstrap/status.json` and stable step/failure markers to `/var/log/ona-bootstrap.log` and the EC2 console;
- forwards bootstrap and maintenance logs to dedicated encrypted CloudWatch log groups once the agent is available, with SNS-backed failure alarms.

A failure before the CloudWatch agent is installed is still visible through EC2 console output and, while the host remains available, SSM and the local status file. The existing ASG capacity/unhealthy-target alarms cover failure to recover capacity.

## Security update policy

Security updates are not disabled. The default randomized timers are replaced by `ona-security-upgrades.timer`:

- AZ suffix `a`: Saturday 06:15 UTC;
- AZ suffix `b`: Saturday 07:15 UTC;
- any future/unknown suffix: Saturday 08:15 UTC.

The timer is non-persistent, has zero random delay, and refuses to start unless the local API and both ALB targets are healthy. It invokes an explicit `Ubuntu:jammy-security` unattended-upgrade allow-list with low CPU/I/O priority and a 10-minute command deadline, then verifies local API health again. The enclosing service allows enough time for bounded apt repair/update plus the upgrade and records TERM/INT as failures. Automatic reboot is disabled. Success/failure state is written to `/var/lib/ona-bootstrap/security-upgrade-status.json`; output is shipped to the `host-maintenance` log group and failures alarm through SNS.

Operators must review pending reboots and perform them as a rolling ASG operation, preserving one healthy target. The bounded staggered timer is temporary and must not be manually triggered on both hosts. Within one week, replace mutable patching with a regularly rebuilt, vulnerability-scanned immutable AMI and rolling instance refresh.

## Temporary AMI freeze

Prod-secondary no longer resolves Canonical's moving `most_recent` image during Terraform plans. Before any plan/apply, set the protected GitHub environment variable `PROD_SECONDARY_AMI_ID` to the exact AMI already used by the current launch template, obtained through an approved read-only operator process. The workflows reject an absent or malformed value and pass it as `TF_VAR_ami_id`. Do not apply this change until the plan confirms the launch template retains that exact image.

This freezes image selection; it does not patch the image. The follow-up baked-AMI rollout must build, scan, rehearse, and explicitly promote a replacement ID before a rolling refresh.

## Rollout

1. Run CI bootstrap validation, `terraform fmt -check -recursive`, and `terraform validate` without hosted credentials in output.
2. Review the prod-secondary plan. Expected changes are a new launch-template version, two log groups, two metric filters/alarms, and an ASG instance refresh; there must be no DB, network, SSM, secret, or data replacement.
3. Confirm `api/latest-compatible.tar.gz` exists through the normal target-account release workflow; do not inspect or print hosted secrets.
4. Apply through the protected prod-secondary Terraform workflow. Keep at least one old healthy target during the rolling refresh.
5. For each replacement, verify `ONA_BOOTSTRAP_SUCCEEDED`, `/health`, expected `REVISION`, SSM registration, and all API/worker health checks before proceeding.
6. Verify both default apt timers are masked, the custom timer uses the AZ-specific slot, and the bootstrap/security failure alarms are `OK`.
7. Exercise the maintenance service on one host in an approved window, verify logs/status, then repeat on the other host.

Do not suspend `ReplaceUnhealthy` for routine rollout. If capacity is at risk, stop the refresh and preserve the last healthy instance while diagnosing.

## Rollback

1. Cancel any active instance refresh.
2. Set the ASG launch template to the previous known-good version (Terraform revert/apply is preferred).
3. Start a rolling refresh only after confirming the previous artifact and launch template are still usable.
4. If a newly bootstrapped host is healthy but its custom maintenance policy must be disabled urgently, stop/disable `ona-security-upgrades.timer`; do not unmask Ubuntu's randomized timers until a reviewed replacement patch window is in place.
5. Rollback does not require or permit database restoration or mutation. No change in this hardening alters RDS data.

If all mirrors are unavailable, repeated replacement cannot manufacture a healthy mutable host. Preserve a healthy target, use the console/SSM status evidence, and prioritize the baked-AMI follow-up rather than extending health grace indefinitely.

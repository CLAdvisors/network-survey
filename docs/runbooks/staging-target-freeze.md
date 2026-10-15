# Staging freeze and route checklist (candidate, code-only)

Status: **candidate code and checklist, not a live freeze.** Nothing in this
document takes effect until the accompanying change is separately approved and
merged. It records how every staging route is expected to fail closed while the
target-account staging environment (`terraform/envs/staging-target`) is
incomplete, and how the freeze is lifted.

## Why

`main` currently auto-deploys pushes to the **source-account** staging stack
(`terraform/envs/staging`, account 438465164125). The approved plan is to build a
new isolated **target-account** staging environment (710054969994) and only then
cut over. Until the target exists and its secure runtime, artifact, session and
smoke gates pass, no staging route may deploy, plan, apply or roll back to either
meaning of "staging".

The gate is `scripts/ci/guard-staging-route.sh`, called by every staging route
workflow before any AWS OIDC assumption. It has **no runtime bypass variable**;
lifting a refusal requires a reviewed code change.

## Route checklist

| # | Route | Entry point | While target incomplete | Fail-closed action |
|---|---|---|---|---|
| 1 | **Freeze** (main push) | `deploy.yml` | source staging auto-deploy removed | no push-triggered deploy exists; guard also refuses route `push` if re-added |
| 2 | **Queued / duplicate runs** | `deploy.yml` / `rollback-api.yml` concurrency | serialized per environment, not cancelled | `cancel-in-progress: false`; concurrency key is the explicit environment |
| 3 | **Manual deploy** | `deploy.yml` dispatch `staging` | frozen | guard refuses route `deploy` |
| 4 | **Manual rollback** | `rollback-api.yml` dispatch `staging` | frozen | guard refuses route `rollback` |
| 5 | **Plan** | `terraform-plan.yml` dispatch `staging` | read-only legacy plan allowed (unchanged) | guard allows route `plan` only |
| 6 | **Plan (target)** | `terraform-plan.yml` dispatch `staging-target` | disabled | guard refuses route `plan`; no live plan/state read |
| 7 | **Apply** | `terraform-apply.yml` dispatch `staging` | frozen | guard refuses route `apply` |
| 8 | **Apply (target)** | `terraform-apply.yml` dispatch `staging-target` | disabled | guard refuses route `apply` |
| 9 | **Prod / prod-secondary** | all four workflows | unchanged | guard allows `prod`, `production`, `prod-secondary` |

Any other environment is refused as unknown.

## Ordering

1. Freeze merge (this change) is a **separate, approved** step, and must land
   **before** any implementation change that could reach staging.
2. The target `staging-target` route stays disabled until the target root is
   provisioned and the stage-0/1/2 gates in
   `terraform/envs/staging-target/README.md` and the planning package pass.
3. Enabling a target route (dispatch option, environment, role, auto-deploy) is
   its own reviewed change; the guard policy is updated with it.

## How to lift

- A target route is enabled by adding it to the workflow's route resolution and
  removing the corresponding `staging-target` refusal from the guard, citing the
  approved provisioning/readiness evidence.
- The legacy source staging deploy freeze is lifted only by an approved change
  that names the target cutover; it is never lifted by an environment variable.

## Explicitly not proven here

This checklist does not freeze live CI, does not prove provisioning readiness,
and does not authorize any live plan, apply, deploy, rollback, DNS or GitHub
setting change.

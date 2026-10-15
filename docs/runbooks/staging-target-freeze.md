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
smoke gates pass, **every** staging route (push, deploy, plan, apply, rollback)
fails closed for both meanings of "staging".

There is no source-plan exception. A normal Terraform route runs `terraform init`
against the remote backend and a default-locking `plan`, so it reads live state
and can write lock objects and local cache/outputs; it is not offline and is
therefore frozen too. The legacy root and state remain preserved for a future,
separately approved read-only operator procedure, but no automatic plan route is
kept.

The gate is `scripts/ci/guard-staging-route.sh`, called by every staging route
workflow before any AWS OIDC assumption. It also binds a configured `TF_ENV`
repository variable to the route's namespace, so a `production`/`prod` route
carrying `TF_ENV=staging` cannot resolve source-staging resources. It has **no
runtime bypass variable**; lifting a refusal requires a reviewed code change.

## Route checklist

| # | Route | Entry point | While target incomplete | Fail-closed action |
|---|---|---|---|---|
| 1 | **Freeze** (main push) | `deploy.yml` | source staging auto-deploy removed | no push-triggered deploy exists; guard also refuses route `push` if re-added |
| 2 | **Queued / duplicate runs** | `deploy.yml` / `rollback-api.yml` concurrency | serialized per environment, not cancelled | `cancel-in-progress: false`; **serialization does not revoke already-queued or old-revision runs** — see the effective-freeze prerequisite below |
| 3 | **Manual deploy** | `deploy.yml` dispatch `staging` | frozen | guard refuses route `deploy` |
| 4 | **Manual rollback** | `rollback-api.yml` dispatch `staging` | frozen | guard refuses route `rollback` |
| 5 | **Plan** | `terraform-plan.yml` dispatch/PR `staging` | frozen | guard refuses route `plan` before OIDC/init; PR and default selections are denied too |
| 6 | **Plan (target)** | `terraform-plan.yml` dispatch `staging-target` | disabled | guard refuses route `plan`; no live plan/state read |
| 7 | **Apply** | `terraform-apply.yml` dispatch `staging` | frozen | guard refuses route `apply` |
| 8 | **Apply (target)** | `terraform-apply.yml` dispatch `staging-target` | disabled | guard refuses route `apply` |
| 9 | **Prod / prod-secondary** | all four workflows | unchanged | guard allows `prod`, `production`, `prod-secondary`; a configured TF_ENV must still match the route namespace |

Any other environment is refused as unknown.

## Effective-freeze prerequisite (before any infrastructure merge)

Merging this guard, or keeping `cancel-in-progress: false`, is **not** proof of a
live freeze: an already-queued, in-progress or manually re-run job executes the
workflow revision checked out when it started, which predates the guard. Before
any infrastructure implementation merge lands, a **separately approved**
effective freeze must run and be evidenced:

1. **Pause** the staging deploy/rollback/plan/apply workflows (disable them or set
   an equivalent approved block).
2. **Drain and check**: cancel/let finish every active and queued run for those
   workflows in every environment whose `TF_ENV` resolves to staging; record the
   run IDs, states and the final check that no staging-mutating run remains.
3. **Block replays**: prevent historical-ref reruns and manual retriggers of
   pre-freeze revisions from executing (remove/disable the old ref, or equivalent).
4. **Land** this guard change, then **re-check** that a fresh push/dispatch of
   every staging route fails closed.

None of steps 1–3 is performed in this code-only tranche; they are GitHub
setting/effect operations requiring separate approval. The receipt is the run
list plus the post-landing refusal check.

## Ordering

1. The separately approved **effective freeze** above (pause + drain/check +
   block replays) precedes everything else.
2. Land this guard change (its own approved step) and re-check that every staging
   route fails closed.
3. The target `staging-target` route stays disabled until the target root is
   provisioned and the stage-0/1/2 gates in
   `terraform/envs/staging-target/README.md` and the planning package pass.
4. Enabling a target route (dispatch option, environment, role, auto-deploy) is
   its own reviewed change; the guard policy is updated with it.

## How to lift

- A target route is enabled by adding it to the workflow's route resolution and
  removing the corresponding `staging-target` refusal from the guard, citing the
  approved provisioning/readiness evidence.
- The legacy source staging route freeze is lifted only by an approved change
  that names the target cutover; it is never lifted by an environment variable.
  A future read-only source plan, if needed, is re-added explicitly with its
  state/lock/cache behavior documented, not by restoring an implicit default.

## Known consequence of the freeze

`terraform-plan.yml` still triggers on `pull_request` to `terraform/**` and
still defaults a dispatch to `staging`. Both now hit the guard and fail closed,
so a Terraform pull request check is expected to fail until the freeze is lifted.
That is the intended fail-closed behaviour, not a broken workflow; it is
recorded here so it is not mistaken for a regression.

## Explicitly not proven here

This checklist does not freeze live CI, does not prove provisioning readiness,
and does not authorize any live plan, apply, deploy, rollback, DNS or GitHub
setting change. It is a candidate plus a checklist, not a receipt.

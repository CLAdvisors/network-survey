# Repository Memory

## Current infra/product context

- The hosted production/demo application is currently considered **inactive / work-in-progress** for users during the infrastructure refactor.
- Users have been told that production is not active while the refactor is underway.
- We still need to protect the existing production database data because it is useful for testing/validation and rollback confidence.
- The production database is backed up, so infra work can prioritize safe iteration and data preservation over maintaining uninterrupted live-user availability.
- Avoid destructive DB operations unless an explicit final snapshot/backup and rollback path are confirmed.
- During this refactor, it is acceptable to make non-disruptive hardening changes first, then perform more structural changes such as Terraform state cleanup, secrets migration, and private networking in planned phases.

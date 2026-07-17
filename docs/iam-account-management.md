# IAM/account management notes

This stacked PR adds backend account-management foundations:

- Owners/admins can list organization members at `GET /api/orgs/:organizationId/members`.
- Owners/admins can update member `role` and user `status` at `PATCH /api/orgs/:organizationId/members/:userId`.
- Guardrails: no self-disable, no last active owner removal, admins cannot modify owners, and role/status values are allow-listed.
- Audit events are written for member updates, survey archives, invite lifecycle, and password reset lifecycle.
- Invites use hashed, expiring tokens. The admin invite creation response returns the raw token/manual link once for delivery until email integration exists.
- Password reset tokens are hashed and expiring. Public reset requests only return raw manual links outside production (or with `RETURN_DEV_TOKENS=true`) until email delivery is wired.

Survey identifiers now have additive `Survey.display_name` and `Survey.slug` fields plus an organization-scoped active slug index. The legacy `Survey.name` primary key remains in place; dashboard calls preserve/use `survey.id` where touched. Fully allowing duplicate display names still requires a later non-destructive primary-key migration away from global `Survey.name` references.

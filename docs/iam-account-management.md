# IAM/account management notes

This stacked PR adds backend account-management foundations:

- Owners/admins can list organization members at `GET /api/orgs/:organizationId/members`.
- Owners/admins can update member `role` and user `status` at `PATCH /api/orgs/:organizationId/members/:userId`.
- Guardrails: no self-disable, no last active owner removal, admins cannot modify owners, and role/status values are allow-listed.
- Audit events are written for member updates, survey archives, invite lifecycle, and password reset lifecycle.
- Invites use hashed, expiring tokens. The admin invite creation response returns the raw token/manual link once for delivery until email integration exists. The Settings UI exposes this as a manual-delivery workflow and does not copy or log the token automatically.
- Password reset tokens are hashed and expiring. Public reset requests only return raw manual links with explicit `RETURN_DEV_TOKENS=true` until email delivery is wired; production UI must not assume raw reset tokens are returned.

Survey identifiers now have additive `Survey.display_name` and `Survey.slug` fields plus an organization-scoped active slug index. The legacy `Survey.name` primary key remains in place; dashboard calls preserve/use `survey.id` where touched. Fully allowing duplicate display names still requires a later non-destructive primary-key migration away from global `Survey.name` references.

Current Settings UI behavior:

- Shows account identity, platform-admin state, organization IDs/names, and the current user's organization role.
- Owners/admins can list members, update roles/statuses, and create manual invites through the existing APIs.
- Non-owner admins do not see owner invite options and cannot modify owner accounts in the UI; backend guardrails remain authoritative.
- Platform admins without organization memberships see a clear follow-up note because this page still renders organizations from session memberships only.

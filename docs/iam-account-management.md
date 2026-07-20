# IAM/account management notes

This stacked PR adds backend account-management foundations:

- Owners/admins can list organization members at `GET /api/orgs/:organizationId/members`.
- Owners/admins can update member `role` and user `status` at `PATCH /api/orgs/:organizationId/members/:userId`.
- Guardrails: no self-disable, no last active owner removal, admins cannot modify owners, and role/status values are allow-listed.
- Audit events are written for member updates, survey archives, invite lifecycle, and password reset lifecycle.
- Invites use hashed, expiring tokens. The admin invite creation response returns the raw token/manual link once. Settings can request invite email delivery when Resend is configured, but still shows the returned one-time link/token as a fallback/manual-delivery warning and does not copy or log it automatically.
- Password reset tokens are hashed and expiring. Public reset requests only return raw manual links with explicit `RETURN_DEV_TOKENS=true` until email delivery is wired; Settings handles the normal no-link response gracefully and only shows manual reset tokens/links when the backend returns them.

Survey identifiers now have additive `Survey.display_name` and `Survey.slug` fields plus an organization-scoped active slug index. The legacy `Survey.name` primary key remains in place; dashboard calls preserve/use `survey.id` where touched. Fully allowing duplicate display names still requires a later non-destructive primary-key migration away from global `Survey.name` references.

Current Settings UI behavior:

- Shows account identity, platform-admin state, organization IDs/names, and the current user's organization role.
- Owners/admins can list members, update roles/statuses, create invites, optionally request invite email delivery, and request password resets through the existing APIs.
- Non-owner admins do not see owner invite options and cannot modify owner accounts in the UI; backend guardrails remain authoritative.
- Platform admins can list organizations through `GET /api/orgs` and use the Settings organization picker to manage orgs even without membership.
- Local `npm run db:setup` bootstraps `LOCAL_ADMIN_USERNAME` as active, platform admin, and owner of `default-imported` when IAM tables exist so fresh local review logins are not left with zero manageable orgs.

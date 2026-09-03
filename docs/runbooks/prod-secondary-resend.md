# prod-secondary Resend isolation

This runbook covers only credential, sender, and webhook isolation for `prod-secondary`. It does not introduce delivery-state migration, canaries, suppression reconciliation, or application quota controls.

## Fixed identity

| Item | Required value |
|---|---|
| AWS account | `710054969994` |
| Region | `us-east-1` |
| Resend team | A team used only by `prod-secondary` |
| Local scope | `network-survey-resend-prod-secondary` |
| Sender | `CLA Survey <survey@cladvisorsurveys.com>` |
| Explicit account/demo Reply-To | `survey@cladvisors.com` |
| Webhook URL | `https://api.cladvisorsurveys.com/api/webhooks/resend` |
| Sending key parameter | `/network-survey/prod-secondary/resend/api-key` |
| Webhook secret parameter | `/network-survey/prod-secondary/resend/webhook-secret` |
| Previous webhook secret parameter | `/network-survey/prod-secondary/resend/webhook-previous-secret` |

Production and staging credentials, domains, webhook registrations, parameter paths, Terraform roots, and provider teams must not be reused or modified. Durable survey invitations retain their existing immutable payload contract and therefore reply to the isolated `survey@cladvisorsurveys.com` sender address; this minimal change does not add delivery snapshot/schema machinery.

## Preparation (all gates off)

1. Confirm application email claiming/sending and webhook processing controls for `prod-secondary` remain disabled.
2. In the isolated Resend team, add and verify `cladvisorsurveys.com` using provider-generated DNS values. DNS work is an explicit, separately approved operator action; Terraform in this repository does not manage it.
3. Create a sending-only API key in that team. Never use a provider-management key as runtime material.
4. Store the key and webhook signing secret as SecureString values at the exact target-account parameter paths above. Do not put values in Terraform, GitHub, logs, command arguments, or this repository.
5. Create the webhook for the exact URL above and leave it disabled. Use the existing `manage-resend-webhook.js` procedure if provider registration automation is approved.
6. Run a target Terraform plan and verify that only account `710054969994` resources are addressed. Applying remains a separately reviewed action.
7. Deploy with `enable_resend_credentials=false` and `enable_resend_webhook_ingest=false`. The application validates the fixed scope, sender, Reply-To, and absence of disabled credentials; secret paths and IAM reads remain absent until each corresponding gate is enabled.

## Activation

Activation is not performed by this change.

1. Set `enable_resend_credentials=true` in a reviewed target-only Terraform change, apply, and deploy while application sending controls remain off.
2. Confirm the application starts without identity validation errors.
3. Set `enable_resend_webhook_ingest=true` only after its exact secret and endpoint are ready; apply and deploy, then enable the matching provider endpoint.
4. Enable existing database-backed webhook processing, sending, and claiming controls only through their established operator procedures.

## Rollback

1. Disable application claiming and sending controls.
2. Disable the isolated provider webhook.
3. Return both Terraform gates to `false`, apply the target-only plan, and redeploy.
4. Rotate or revoke only the prod-secondary key/secret if exposure or cross-wiring is suspected.

Do not transfer a domain, key, webhook, or secret to production or staging as a rollback mechanism.

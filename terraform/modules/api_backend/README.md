# API/backend Terraform module

Shared module for the Network Survey API/backend stack used by `terraform/envs/staging` and `terraform/envs/prod`.

The module owns the common backend resources only:

- API config and artifact S3 buckets and bucket controls
- Runtime config S3 object
- EC2 IAM role, policy, policy attachments, and instance profile
- Backend EC2 instance and Ubuntu AMI lookup
- API ALB, HTTP/HTTPS listeners, target group, attachment
- Backend and ALB security groups

Environment roots continue to own database resources, ACM certificates, frontend modules, and environment-specific networking/subnets.

Before applying this refactor in an environment, move the existing state addresses into the module addresses documented in `../../docs/api-backend-module-state-moves.md`, then verify a no-op or expected-no-replacement plan.

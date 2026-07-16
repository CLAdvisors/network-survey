# API/backend module state moves

This refactor moves existing API/backend resources under `module.api_backend` without applying AWS changes. Do **not** run `terraform apply` until the relevant environment state has been moved and a plan has been reviewed.

Run from the environment directory shown. Quote addresses containing `[`/`]` so your shell does not expand them.

## Staging

```bash
cd terraform/envs/staging

terraform state mv 'aws_security_group.backend_sg' 'module.api_backend.aws_security_group.backend_sg'
terraform state mv 'aws_security_group.alb_sg' 'module.api_backend.aws_security_group.alb_sg'
terraform state mv 'aws_instance.backend' 'module.api_backend.aws_instance.backend'
terraform state mv 'aws_s3_bucket.config_bucket' 'module.api_backend.aws_s3_bucket.config_bucket'
terraform state mv 'aws_s3_bucket_public_access_block.config_bucket_public_access' 'module.api_backend.aws_s3_bucket_public_access_block.bucket_public_access["config"]'
terraform state mv 'aws_s3_bucket_ownership_controls.config_bucket_ownership' 'module.api_backend.aws_s3_bucket_ownership_controls.config_bucket_ownership[0]'
terraform state mv 'aws_s3_bucket_server_side_encryption_configuration.config_bucket_encryption' 'module.api_backend.aws_s3_bucket_server_side_encryption_configuration.bucket_encryption["config"]'
terraform state mv 'aws_s3_bucket_versioning.config_bucket_versioning' 'module.api_backend.aws_s3_bucket_versioning.bucket_versioning["config"]'
terraform state mv 'aws_s3_object.api_config' 'module.api_backend.aws_s3_object.api_config'
terraform state mv 'aws_s3_bucket.artifacts' 'module.api_backend.aws_s3_bucket.artifacts'
terraform state mv 'aws_s3_bucket_public_access_block.artifacts_public_access' 'module.api_backend.aws_s3_bucket_public_access_block.bucket_public_access["artifacts"]'
terraform state mv 'aws_s3_bucket_versioning.artifacts_versioning' 'module.api_backend.aws_s3_bucket_versioning.bucket_versioning["artifacts"]'
terraform state mv 'aws_s3_bucket_server_side_encryption_configuration.artifacts_encryption' 'module.api_backend.aws_s3_bucket_server_side_encryption_configuration.bucket_encryption["artifacts"]'
terraform state mv 'aws_s3_bucket_lifecycle_configuration.artifacts_lifecycle' 'module.api_backend.aws_s3_bucket_lifecycle_configuration.artifacts_lifecycle'
terraform state mv 'aws_iam_role.ec2_role' 'module.api_backend.aws_iam_role.ec2_role'
terraform state mv 'aws_iam_policy.s3_access_policy' 'module.api_backend.aws_iam_policy.s3_access_policy'
terraform state mv 'aws_iam_role_policy_attachment.ec2_s3_policy' 'module.api_backend.aws_iam_role_policy_attachment.ec2_s3_policy'
terraform state mv 'aws_iam_role_policy_attachment.ec2_ssm_policy' 'module.api_backend.aws_iam_role_policy_attachment.ec2_ssm_policy'
terraform state mv 'aws_s3_bucket_policy.config_bucket_policy' 'module.api_backend.aws_s3_bucket_policy.config_bucket_policy'
terraform state mv 'aws_iam_instance_profile.ec2_instance_profile' 'module.api_backend.aws_iam_instance_profile.ec2_instance_profile'
terraform state mv 'aws_lb_target_group.backend_targets' 'module.api_backend.aws_lb_target_group.backend_targets'
terraform state mv 'aws_lb.main_alb' 'module.api_backend.aws_lb.main_alb'
terraform state mv 'aws_lb_listener.http_redirect' 'module.api_backend.aws_lb_listener.http_redirect'
terraform state mv 'aws_lb_listener.https_listener' 'module.api_backend.aws_lb_listener.https_listener'
terraform state mv 'aws_lb_target_group_attachment.backend_attachments["instance1"]' 'module.api_backend.aws_lb_target_group_attachment.backend_attachments["instance1"]'
```

## Production

```bash
cd terraform/envs/prod

terraform state mv 'aws_security_group.prod_alb' 'module.api_backend.aws_security_group.alb_sg'
terraform state mv 'aws_security_group.prod_backend' 'module.api_backend.aws_security_group.backend_sg'
terraform state mv 'aws_iam_role.prod_backend' 'module.api_backend.aws_iam_role.ec2_role'
terraform state mv 'aws_iam_policy.prod_backend_runtime' 'module.api_backend.aws_iam_policy.s3_access_policy'
terraform state mv 'aws_iam_role_policy_attachment.prod_backend_runtime' 'module.api_backend.aws_iam_role_policy_attachment.ec2_s3_policy'
terraform state mv 'aws_iam_role_policy_attachment.prod_backend_ssm' 'module.api_backend.aws_iam_role_policy_attachment.ec2_ssm_policy'
terraform state mv 'aws_iam_instance_profile.prod_backend' 'module.api_backend.aws_iam_instance_profile.ec2_instance_profile'
terraform state mv 'aws_instance.prod_backend' 'module.api_backend.aws_instance.backend'
terraform state mv 'aws_lb_target_group.prod_backend' 'module.api_backend.aws_lb_target_group.backend_targets'
terraform state mv 'aws_lb.prod_api' 'module.api_backend.aws_lb.main_alb'
terraform state mv 'aws_lb_listener.prod_api_http' 'module.api_backend.aws_lb_listener.http_redirect'
terraform state mv 'aws_lb_listener.prod_api_https' 'module.api_backend.aws_lb_listener.https_listener'
terraform state mv 'aws_lb_target_group_attachment.prod_backend' 'module.api_backend.aws_lb_target_group_attachment.backend_attachment[0]'
terraform state mv 'aws_s3_bucket.prod_app_config' 'module.api_backend.aws_s3_bucket.config_bucket'
terraform state mv 'aws_s3_bucket.prod_app_artifacts' 'module.api_backend.aws_s3_bucket.artifacts'
terraform state mv 'aws_s3_bucket_public_access_block.prod_app["config"]' 'module.api_backend.aws_s3_bucket_public_access_block.bucket_public_access["config"]'
terraform state mv 'aws_s3_bucket_public_access_block.prod_app["artifacts"]' 'module.api_backend.aws_s3_bucket_public_access_block.bucket_public_access["artifacts"]'
terraform state mv 'aws_s3_bucket_server_side_encryption_configuration.prod_app["config"]' 'module.api_backend.aws_s3_bucket_server_side_encryption_configuration.bucket_encryption["config"]'
terraform state mv 'aws_s3_bucket_server_side_encryption_configuration.prod_app["artifacts"]' 'module.api_backend.aws_s3_bucket_server_side_encryption_configuration.bucket_encryption["artifacts"]'
terraform state mv 'aws_s3_bucket_versioning.prod_app["config"]' 'module.api_backend.aws_s3_bucket_versioning.bucket_versioning["config"]'
terraform state mv 'aws_s3_bucket_versioning.prod_app["artifacts"]' 'module.api_backend.aws_s3_bucket_versioning.bucket_versioning["artifacts"]'
terraform state mv 'aws_s3_bucket_lifecycle_configuration.prod_app_artifacts' 'module.api_backend.aws_s3_bucket_lifecycle_configuration.artifacts_lifecycle'
terraform state mv 'aws_s3_object.prod_api_config' 'module.api_backend.aws_s3_object.api_config'
terraform state mv 'aws_s3_bucket_policy.prod_app_config' 'module.api_backend.aws_s3_bucket_policy.config_bucket_policy'
```

## Verification

After the moves for an environment:

```bash
terraform plan
```

Expected result: no resource replacement. If Terraform proposes replacement, stop and inspect the moved address and module inputs before applying.

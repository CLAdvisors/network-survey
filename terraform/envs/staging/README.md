# Staging Terraform environment

This root is the staging successor to the legacy workspace-based root at
`terraform/` + workspace `staging` + `staging.tfvars`.

- Backend bucket: `network-survey-terraform-state-438465164125`
- Backend key: `envs/staging/terraform.tfstate`
- This is the active staging Terraform root.
- Staging state has been migrated into this backend key.
- Plans/applies from this root are expected to be no-op unless an intentional
  staging change is being reviewed.

Secrets:

```sh
export TF_VAR_db_password=...
```

Validate locally:

```sh
terraform init -backend=false
terraform validate
```

Plan against the active staging state:

```sh
terraform init
terraform plan -var-file=staging.tfvars
```

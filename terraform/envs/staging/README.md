# Staging Terraform environment

This root is the staging successor to the legacy workspace-based root at
`terraform/` + workspace `staging` + `staging.tfvars`.

- Backend bucket: `network-survey-terraform-state-438465164125`
- Backend key: `envs/staging/terraform.tfstate`
- No Terraform state was migrated in this PR.
- Do not run `terraform apply` from this root until the migration steps in
  `terraform/README.md` have been reviewed and executed.

Secrets:

```sh
export TF_VAR_db_password=...
```

Validate locally:

```sh
terraform init -backend=false
terraform validate
```

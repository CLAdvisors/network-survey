# This root is retained only for historical/rollback reference.
# Active stacks live under terraform/envs/staging and terraform/envs/prod.
# The guard below intentionally makes planning/applying this legacy root fail
# unless an operator deliberately opts in with -var='allow_legacy_root_apply=true'.

variable "allow_legacy_root_apply" {
  description = "Emergency-only escape hatch for the archived legacy Terraform root. Leave false for all normal operations."
  type        = bool
  default     = false
}

resource "terraform_data" "legacy_root_disabled" {
  input = "legacy-root-disabled"

  lifecycle {
    precondition {
      condition     = var.allow_legacy_root_apply
      error_message = "The workspace-based terraform/ root is legacy-only. Use terraform/envs/staging or terraform/envs/prod. Set allow_legacy_root_apply=true only for an explicit, reviewed rollback operation."
    }
  }
}

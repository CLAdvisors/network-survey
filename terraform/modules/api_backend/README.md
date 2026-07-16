# API/backend module candidate

This directory is intentionally documentation-only for now. The production and
staging API/backend stacks currently differ in enough active-resource details
(VPC ownership, subnet layout, RDS access, IAM policy scope, imported/legacy
cutover concerns, and prod-v2 discovery tags) that extracting a live module in
this change would increase replacement risk.

Future extraction should be done after prod-v2 state/address migration is
verified with a no-op plan. Recommended approach:

1. Inventory staging and prod backend resource arguments and lifecycle rules.
2. Design module inputs for existing VPC/subnets/security groups, ALB listeners,
   runtime SSM parameter names, artifact/config buckets, and discovery tags.
3. Introduce the module in one environment at a time with explicit
   `terraform state mv` commands and a reviewed no-op plan before any apply.
4. Keep RDS resources outside the module until DB ownership and backup/rollback
   procedures are separately reviewed.

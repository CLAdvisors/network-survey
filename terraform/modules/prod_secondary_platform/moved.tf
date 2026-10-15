# Account-global resources stay owned only by the existing prod-secondary state.
# Isolating a second (staging) instance of this module must not acquire or
# modify their account scope, so they are gated to prod-secondary with
# environment-conditional counts. These moves are state-address only for the
# existing prod-secondary module instance (for example
# aws_s3_account_public_access_block.this -> aws_s3_account_public_access_block.this[0]);
# they are no-ops on the fresh, empty staging state and must be confirmed by a
# read-only prod-secondary plan before any separately approved state apply.

moved {
  from = aws_s3_account_public_access_block.this
  to   = aws_s3_account_public_access_block.this[0]
}

moved {
  from = aws_iam_service_linked_role.autoscaling
  to   = aws_iam_service_linked_role.autoscaling[0]
}

moved {
  from = aws_ebs_encryption_by_default.this
  to   = aws_ebs_encryption_by_default.this[0]
}

moved {
  from = aws_ebs_default_kms_key.this
  to   = aws_ebs_default_kms_key.this[0]
}

moved {
  from = aws_sns_topic_subscription.operations_email
  to   = aws_sns_topic_subscription.operations_email[0]
}

moved {
  from = data.aws_iam_role.github_deploy
  to   = data.aws_iam_role.github_deploy[0]
}

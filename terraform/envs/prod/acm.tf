resource "aws_acm_certificate" "prod_api" {
  domain_name       = "demo.ona.api.bennetts.work"
  validation_method = "DNS"

  tags = merge(local.prod_app_tags, {
    Name = "prod-api-certificate"
    App  = "ona-api"
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_acm_certificate" "prod_dashboard" {
  domain_name       = "demo.ona.dashboard.bennetts.work"
  validation_method = "DNS"

  tags = merge(local.prod_app_tags, {
    Name = "prod-dashboard-certificate"
    App  = "ona-dashboard"
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_acm_certificate" "prod_survey" {
  domain_name       = "demo.ona.survey.bennetts.work"
  validation_method = "DNS"

  tags = merge(local.prod_app_tags, {
    Name = "prod-survey-certificate"
    App  = "ona-survey"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Preserve the deployed hotfix certificate state while adopting the current
# resource name. These moves are no-ops where the historical address is absent.
moved {
  from = aws_acm_certificate.prod_survey_customer
  to   = aws_acm_certificate.prod_survey_canonical
}

moved {
  from = aws_acm_certificate_validation.prod_survey_customer
  to   = aws_acm_certificate_validation.prod_survey_canonical
}

# Keep the imported historical certificate above in state. CloudFront can attach
# only one viewer certificate, so this additive certificate covers the canonical
# hostname and every retained legacy alias.
resource "aws_acm_certificate" "prod_survey_canonical" {
  # Certificate identity is deliberately independent of the active link domain.
  # Rolling new links back to a retained alias must not replace this certificate.
  domain_name = var.survey_certificate_domain
  subject_alternative_names = [
    for domain in local.survey_domains : domain
    if domain != var.survey_certificate_domain
  ]
  validation_method = "DNS"

  tags = merge(local.prod_app_tags, {
    Name = "prod-canonical-survey-certificate"
    App  = "ona-survey"
  })

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true

    precondition {
      condition     = contains(local.survey_domains, var.survey_link_domain)
      error_message = "survey_link_domain must be retained in the stable survey certificate, CloudFront alias, and CORS domain set."
    }
  }
}

# DNS remains externally managed. Create the certificate first, publish its
# validation records, and attach it only after ACM reports ISSUED.
resource "aws_acm_certificate_validation" "prod_survey_canonical" {
  certificate_arn = aws_acm_certificate.prod_survey_canonical.arn
  validation_record_fqdns = [
    for option in aws_acm_certificate.prod_survey_canonical.domain_validation_options : option.resource_record_name
  ]
}

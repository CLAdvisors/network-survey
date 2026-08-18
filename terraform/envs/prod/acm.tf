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

# CloudFront accepts only one viewer certificate. Keep the imported historical
# certificate above, and attach this additive certificate covering both the new
# canonical hostname and every retained legacy survey hostname.
resource "aws_acm_certificate" "prod_survey_customer" {
  domain_name               = var.survey_domain
  subject_alternative_names = var.legacy_survey_domains
  validation_method         = "DNS"

  tags = merge(local.prod_app_tags, {
    Name = "prod-customer-survey-certificate"
    App  = "ona-survey"
  })

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }
}

# Validation records are managed by the external DNS provider. Bootstrap the
# certificate with a targeted apply, publish the output CNAMEs, then run the
# reviewed full apply after ACM reports ISSUED.
resource "aws_acm_certificate_validation" "prod_survey_customer" {
  certificate_arn = aws_acm_certificate.prod_survey_customer.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.prod_survey_customer.domain_validation_options : dvo.resource_record_name
  ]
}

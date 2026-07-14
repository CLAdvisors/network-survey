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

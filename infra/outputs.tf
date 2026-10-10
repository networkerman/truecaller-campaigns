output "dashboard_url" {
  value = "https://${var.domain_name == "" ? aws_cloudfront_distribution.web.domain_name : var.domain_name}"
}

# Add both records at your DNS provider
output "cert_validation_record" {
  value = var.domain_name == "" ? null : [for o in aws_acm_certificate.web[0].domain_validation_options : {
    type  = o.resource_record_type
    name  = o.resource_record_name
    value = o.resource_record_value
  }]
}

output "domain_cname_record" {
  value = var.domain_name == "" ? null : {
    type  = "CNAME"
    name  = var.domain_name
    value = aws_cloudfront_distribution.web.domain_name
  }
}

output "api_url" {
  value = "https://${aws_apprunner_service.api.service_url}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

# Values for the GitHub repo variables (Settings > Secrets and variables > Actions > Variables)
output "github_variables" {
  value = {
    AWS_DEPLOY_ROLE_ARN = aws_iam_role.deploy.arn
    ECR_REPOSITORY      = aws_ecr_repository.api.name
    WEB_BUCKET          = aws_s3_bucket.web.bucket
    CLOUDFRONT_ID       = aws_cloudfront_distribution.web.id
    APP_SECRET_ARN      = aws_secretsmanager_secret.app.arn
    WORKER_CLUSTER      = aws_ecs_cluster.main.name
    WORKER_SERVICE      = aws_ecs_service.worker.name
  }
}

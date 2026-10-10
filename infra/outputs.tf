output "dashboard_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
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
  }
}

# AWS deployment

Region `ap-south-1`. The API runs on App Runner, the database on RDS Postgres 16, and the dashboard on S3 + CloudFront. CloudFront sends `/v1/*`, `/webhooks/*` and `/health` to the API, so everything is served from one URL.

Rough cost: $30–45/month (RDS t4g.micro ~$15, App Runner 0.25 vCPU ~$10–25, rest is small).

## First-time setup (once)

Needs Terraform ≥ 1.6, the AWS CLI logged in to the target account, and Docker.

```bash
cd infra
terraform init

# 1. Create the image registry first; App Runner needs an image before it can start
terraform apply -target=aws_ecr_repository.api

# 2. Push a first image
REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin "${REPO%%/*}"
docker build -t "$REPO:latest" ../server && docker push "$REPO:latest"

# 3. Request the SSL certificate for truecaller.udchowdhury.me
terraform apply -target=aws_acm_certificate.web
terraform output cert_validation_record
#    Add that CNAME at your DNS provider, then continue

# 4. Create everything else (~15 min, mostly RDS and CloudFront).
#    It waits for the certificate to validate, so the DNS record must be in place.
terraform apply
terraform output github_variables
terraform output domain_cname_record
#    Add this CNAME too: truecaller.udchowdhury.me -> dxxxx.cloudfront.net
```

If the account already has the GitHub OIDC provider, add `-var create_github_oidc_provider=false` to the applies.

Then in GitHub → **Settings → Secrets and variables → Actions → Variables**, add the five values from `github_variables`. Re-run the **Deploy** workflow (or push to `main`) to publish the dashboard.

Open https://truecaller.udchowdhury.me once DNS has picked up the CNAME (usually a few minutes).

To skip the custom domain, add `-var domain_name=` to every apply.

## After that

Every push to `main` builds the API image (App Runner picks it up on its own) and republishes the dashboard.

## Going live with Truecaller

1. Fill `TC_API_KEY` and `TC_WEBHOOK_SECRET` in the `truecaller-campaigns/app` secret in Secrets Manager.
2. `terraform apply -var tc_provider=truecaller` (also set `TC_API_BASE_URL` / `TC_SENDER_ID` in `runtime_environment_variables`).
3. The API reaches the internet through the VPC, so live mode needs a NAT gateway (~$35/month) or VPC endpoints. Mock mode doesn't.

## Notes

- Terraform state is local. Keep `infra/terraform.tfstate` safe (it holds the DB password) or move it to an S3 backend before anyone else runs Terraform.
- The dashboard has the API key built into its JavaScript, so anyone who opens the dashboard can read it. Fine for a mock demo; replace with a login before real customers or real sends.
- RDS has deletion protection on. To tear down, turn it off first.

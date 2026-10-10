# Deploying to AWS

One EC2 host in `ap-south-1` (Mumbai) runs everything with Docker Compose:

- **web**: Caddy serves the dashboard, proxies `/v1`, `/webhooks` and `/health` to the API, and gets HTTPS certificates automatically
- **server**: the API (runs migrations on start)
- **db**: Postgres 16, data on a Docker volume

`deploy/cloudformation.yml` creates the host, an Elastic IP, ECR repos and an IAM role. There is no SSH; deploys go through SSM.

## One-time setup

1. Add these repository secrets in GitHub (Settings → Secrets and variables → Actions):
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: an IAM user that can manage CloudFormation, EC2, ECR, IAM roles and SSM
   - `API_KEY`: the key customers and the dashboard use for `/v1`
   - `DASHBOARD_PASSWORD`: dashboard login password (user is `admin`)
2. Run the **Deploy to AWS** workflow (Actions tab → Run workflow). Every push to `main` deploys after that.
3. Point an `A` record for `truecaller.udchowdhury.me` at the IP in the workflow summary. Caddy picks up a certificate once DNS resolves.

## Truecaller credentials

Put them in SSM Parameter Store (SecureString) in `ap-south-1`, then re-run the workflow:

`/truecaller/TC_PROVIDER` (`truecaller`), `/truecaller/TC_API_BASE_URL`, `/truecaller/TC_API_KEY`, `/truecaller/TC_SENDER_ID`, `/truecaller/TC_WEBHOOK_SECRET`

Until `TC_PROVIDER` is set, the app runs in mock mode.

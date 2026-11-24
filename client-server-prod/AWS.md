# AWS Pre-Push Setup Checklist (`client-server-prod`)

Because **AWS CDK** ([`infra/`](./infra/)) provisions the infrastructure automatically, you do **not** need to manually create the S3 bucket, CloudFront distribution, VPC, EC2 instance, Security Group, or Elastic IP.

Before pushing to `main` (which triggers [`.github/workflows/client-server-prod.yml`](../.github/workflows/client-server-prod.yml)), complete the **one-time prerequisites** below.

---

## Manual Prerequisites vs. CDK-Managed Resources

| Created Manually (Before First Push) | Created Automatically by AWS CDK |
| :--- | :--- |
| **ACM Certificate** (`us-east-1`) for `fib1.techtoday.click` | Private **S3 Bucket** (OAC) + **CloudFront** (`https://fib1.techtoday.click`) |
| **EC2 Key Pair** (`.pem`) for SSH/rsync deploys | Public-only **VPC** (0 NAT Gateways) + **Security Group** (`80`, `443`, `22`) |
| **CDK Bootstrap** (`CDKToolkit`) in your target region | **EC2 `t4g.micro`** (Amazon Linux 2023 ARM64) + **Elastic IP** |
| **GitHub OIDC Provider + IAM Role** *(shared with `multi-container-services-prod`)* | User Data bootstrap: installs **Docker**, **Compose v2**, `rsync`, and `ec2/.env` |
| **GitHub Variables & `EC2_SSH_KEY` Secret** | Route 53 DNS records *(if `ROUTE53_HOSTED_ZONE_ID` is set)* |

---

## 1. Request an ACM Certificate in `us-east-1` (Mandatory)

> **Critical:** CloudFront only accepts certificates issued in **`us-east-1` (N. Virginia)**.

1. Switch AWS Console region to **`us-east-1`**.
2. Open **ACM → Request a certificate → Request a public certificate**.
3. **Fully qualified domain name:** `fib1.techtoday.click`
4. **Validation method:** **DNS validation** — add the CNAME record in your DNS provider and wait until **Status = Issued**.
5. Copy the **Certificate ARN** (used as `FIB1_ACM_CERTIFICATE_ARN`).

*(No ACM certificate is needed for `api.fib1.techtoday.click` — Caddy provisions and renews Let's Encrypt TLS automatically on EC2.)*

---

## 2. Create an EC2 Key Pair (In Your Target Region)

1. Switch AWS Console to your target deployment region (e.g., `ap-south-1` or `us-east-1`).
2. Open **EC2 → Network & Security → Key pairs → Create key pair**.
3. Name it (e.g., `fib1-ec2-key`), format **`.pem`**, and download the private key.
4. You will store:
   - The **key pair name** (`fib1-ec2-key`) in GitHub Variable `EC2_KEY_PAIR_NAME`.
   - The **contents of `.pem`** in GitHub Secret `EC2_SSH_KEY`.

---

## 3. Bootstrap AWS CDK & Configure GitHub OIDC

If you already completed **Steps 2 & 3** in [`multi-container-services-prod/AWS.md`](../multi-container-services-prod/AWS.md) for the same AWS account and region, **you can reuse the exact same CDK bootstrap and GitHub OIDC IAM role**!

Otherwise:
1. Run `npx cdk bootstrap aws://<ACCOUNT_ID>/<TARGET_REGION>` inside `client-server-prod/infra/`.
2. Create the GitHub OIDC provider (`https://token.actions.githubusercontent.com`) and IAM role with `sts:AssumeRole` on `arn:aws:iam::<ACCOUNT_ID>:role/cdk-*`.

---

## 4. Add GitHub Repository Variables & Secret

### Repository Variables (`Settings → Secrets and variables → Actions → Variables`)

| Variable Name | Required | Example Value |
| :--- | :--- | :--- |
| `AWS_REGION` | Yes | `ap-south-1` (or `us-east-1`) |
| `AWS_OIDC_ROLE_ARN` | Yes | `arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-...` |
| `FIB1_ACM_CERTIFICATE_ARN` | Yes | `arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<UUID>` |
| `EC2_KEY_PAIR_NAME` | Yes | `fib1-ec2-key` |
| `ROUTE53_HOSTED_ZONE_ID` | Optional | `Z0123456789ABCDEFGHIJ` *(if `techtoday.click` is in Route 53)* |

### Repository Secret (`Settings → Secrets and variables → Actions → Secrets`)

| Secret Name | Required | Value |
| :--- | :--- | :--- |
| `EC2_SSH_KEY` | Yes | Full contents of your `fib1-ec2-key.pem` private key |

---

## 5. DNS Records (`techtoday.click`)

- **If `ROUTE53_HOSTED_ZONE_ID` is set:** CDK creates all records below automatically.
- **If using external DNS (Cloudflare, Namecheap, GoDaddy, etc.):** After the first deploy finishes, copy `CloudFrontDomainName` and `Ec2PublicIp` from the stack outputs and create:

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib1.techtoday.click` | **CNAME** | `<CloudFrontDomainName>` | Cloudflare: set to **DNS only (gray cloud)** |
| `api.fib1.techtoday.click` | **A** | `<Ec2PublicIp>` | Required for Caddy Let's Encrypt HTTPS |

> **Note on first deploy:** On the very first run, Caddy needs `api.fib1.techtoday.click` to resolve to `<Ec2PublicIp>` in order to issue its Let's Encrypt certificate. If using external DNS, add the `A` record after CDK finishes and then re-run `deploy-server` (or wait ~1 minute for Caddy's automatic retry).

---

## Estimated Monthly Cost

| Resource | Approx. Monthly Cost |
| :--- | :--- |
| EC2 `t4g.micro` + 20 GB `gp3` + Elastic IP (attached) | ~\$7–9 *(Free Tier eligible)* |
| S3 + CloudFront + ACM | ~\$0–1 |
| **Total** | **~\$8–10/month** |

# Manual AWS Console Setup Guide (`client-server-prod`)

Follow this checklist to provision all AWS resources manually before your first deployment (local CLI or GitHub Actions via [`.github/workflows/client-server-prod.yml`](../.github/workflows/client-server-prod.yml)).

---

## Resources You Will Create

| Resource | Region | Purpose |
| :--- | :--- | :--- |
| **ACM Certificate** | `us-east-1` *(required)* | TLS certificate for `fib1.techtoday.click` on CloudFront |
| **Amazon S3 Bucket** | Target region | Private static hosting for `client/dist/` |
| **Amazon CloudFront Distribution** | Global | HTTPS CDN with OAC to S3 + SPA routing fallback |
| **EC2 Key Pair & Security Group** | Target region | SSH access (`22`) and Caddy HTTP/HTTPS (`80`, `443` TCP/UDP) |
| **EC2 Instance (`t4g.micro`) + Elastic IP** | Target region | Runs Express API + Caddy 2 via Docker Compose |
| **DNS Records** | DNS provider / Route 53 | `fib1.techtoday.click` -> CloudFront, `api.fib1.techtoday.click` -> Elastic IP |
| **GitHub OIDC Provider + IAM Role** | Global (IAM) | Passwordless CI/CD deploys to S3 + CloudFront |

---

## 1. Request an ACM Certificate in `us-east-1` (Mandatory)

> **Critical:** CloudFront only accepts certificates issued in **`us-east-1` (N. Virginia)**, even if your S3 bucket and EC2 instance live in another region (e.g., `ap-south-1`).

1. Switch the AWS Console region to **`us-east-1`**.
2. Open **AWS Certificate Manager (ACM) → Request a certificate → Request a public certificate**.
3. **Fully qualified domain name:** `fib1.techtoday.click`
4. **Validation method:** **DNS validation** → click **Request**.
5. Add the validation CNAME record to your DNS provider for `techtoday.click` (keep it permanently for auto-renewal) and wait until **Status = Issued**.

*(No ACM certificate is needed for `api.fib1.techtoday.click` — Caddy provisions and renews Let's Encrypt TLS automatically on EC2.)*

---

## 2. Create a Private Amazon S3 Bucket (Frontend)

1. Switch the AWS Console to your target region (e.g., `ap-south-1` or `us-east-1`).
2. Open **S3 → Create bucket**.
3. **Bucket name:** Globally unique name, e.g. `fib1-techtoday-click-frontend` (save this for `FIB1_S3_BUCKET`).
4. **Object Ownership:** ACLs disabled (recommended).
5. **Block Public Access:** Keep **Block all public access** enabled.
6. **Default encryption:** Server-side encryption with Amazon S3 managed keys (SSE-S3).
7. Click **Create bucket**.

---

## 3. Create an Amazon CloudFront Distribution

1. Open **CloudFront → Distributions → Create distribution**.
2. **Origin:**
   - **Origin domain:** Select your S3 bucket (`fib1-techtoday-click-frontend`).
   - **Origin access:** Select **Origin access control settings (recommended)** → **Create new OAC** (keep defaults, sign requests).
3. **Default cache behavior:**
   - **Viewer protocol policy:** **Redirect HTTP to HTTPS**.
   - **Allowed HTTP methods:** `GET, HEAD`.
   - **Cache policy:** `CachingOptimized`.
4. **Web Application Firewall (WAF):** Choose based on your budget (e.g., Do not enable security protections for minimal cost).
5. **Settings:**
   - **Alternate domain name (CNAME):** `fib1.techtoday.click`
   - **Custom SSL certificate:** Select the issued `us-east-1` ACM certificate for `fib1.techtoday.click`.
   - **Default root object:** `index.html`
6. Click **Create distribution**.
7. **Update the S3 Bucket Policy (Required):**
   - CloudFront displays a banner with a **Copy policy** button.
   - Open your S3 bucket → **Permissions → Bucket policy → Edit**, paste the copied OAC policy, and save.
8. **Configure SPA Fallback (Custom Error Responses):**
   - Open the CloudFront distribution → **Error pages → Create custom error response** twice:
     - **HTTP error code `403`** → Customize error response: **Yes** → Response page path: `/index.html` → HTTP Response code: `200` → Error caching minimum TTL: `0`.
     - **HTTP error code `404`** → Customize error response: **Yes** → Response page path: `/index.html` → HTTP Response code: `200` → Error caching minimum TTL: `0`.
9. Copy:
   - **Distribution ID** (used as `FIB1_CLOUDFRONT_DISTRIBUTION_ID`).
   - **Distribution domain name** (e.g., `d1234abcd.cloudfront.net`, used for DNS).

---

## 4. Create the Backend EC2 Instance & Elastic IP

### 4.1 Create an EC2 Key Pair
1. In your target region, open **EC2 → Network & Security → Key pairs → Create key pair**.
2. Name it (e.g., `fib1-ec2-key`), format **`.pem`**, and download the private key (`chmod 400 fib1-ec2-key.pem`).

### 4.2 Create a Security Group
1. Open **EC2 → Network & Security → Security Groups → Create security group**.
2. Name: `fib1-api-ec2-sg`, VPC: your default (or public) VPC.
3. **Inbound rules:**
   - **HTTP** — TCP `80` — `0.0.0.0/0` *(Caddy ACME HTTP-01 challenge & HTTPS redirect)*
   - **HTTPS** — TCP `443` — `0.0.0.0/0` *(HTTPS API traffic)*
   - **Custom UDP** — UDP `443` — `0.0.0.0/0` *(HTTP/3 / QUIC traffic for Caddy)*
   - **SSH** — TCP `22` — `0.0.0.0/0` *(needed for GitHub-hosted runners; restrict to `<YOUR_IP>/32` if deploying only from your machine)*
4. **Outbound rules:** Allow all outbound traffic (`0.0.0.0/0`).

### 4.3 Launch the EC2 Instance
1. Open **EC2 → Instances → Launch instances**:
   - **Name:** `fib1-api-ec2`
   - **AMI:** **Amazon Linux 2023 AMI** (**64-bit (Arm)**)
   - **Instance type:** `t4g.micro`
   - **Key pair:** Select `fib1-ec2-key`
   - **Network settings:** Public subnet with Auto-assign public IP enabled; select existing security group `fib1-api-ec2-sg`
   - **Storage:** `20 GiB` `gp3` (encrypted)
   - **Advanced details → Metadata version:** V2 only (IMDSv2 required)
   - **Advanced details → User data:** Paste the bootstrap script below so Docker, Compose v2, `rsync`, and `ec2/.env` are ready automatically on first boot:

```bash
#!/bin/bash
set -euxo pipefail

dnf update -y
dnf install -y docker rsync
systemctl enable --now docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /home/ec2-user/client-server-prod/server /home/ec2-user/client-server-prod/ec2
cat <<'EOF' > /home/ec2-user/client-server-prod/ec2/.env
API_DOMAIN=api.fib1.techtoday.click
CLIENT_ORIGIN=https://fib1.techtoday.click
EOF
chown -R ec2-user:ec2-user /home/ec2-user/client-server-prod
```

2. Click **Launch instance**.

### 4.4 Allocate and Associate an Elastic IP
1. Open **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address**.
2. Select the new Elastic IP → **Actions → Associate Elastic IP address** → choose `fib1-api-ec2` → **Associate**.
3. Copy the Elastic IP (used for DNS and GitHub Secret `EC2_HOST`).

---

## 5. Configure DNS Records (`techtoday.click`)

Create the following DNS records in Route 53 or your external DNS provider:

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib1.techtoday.click` | **A / AAAA (Alias)** in Route 53 *or* **CNAME** externally | `<CloudFrontDomainName>` (e.g. `d1234abcd.cloudfront.net`) | Cloudflare: set to **DNS only (gray cloud)** |
| `api.fib1.techtoday.click` | **A** | `<Ec2ElasticIp>` | Required for Caddy Let's Encrypt HTTPS |

> **Note:** Make sure `api.fib1.techtoday.click` resolves to `<Ec2ElasticIp>` before starting Caddy on EC2 so Let's Encrypt can issue the TLS certificate on the first attempt.

---

## 6. Configure GitHub OIDC & IAM Role (For CI/CD)

The GitHub Actions workflow uses **OIDC** (short-lived temporary tokens, no static AWS access keys).

### 6.1 Add GitHub as an IAM OIDC Provider (Skip if Already Exists)
1. Open **IAM → Identity providers → Add provider**.
2. **Provider type:** `OpenID Connect`
3. **Provider URL:** `https://token.actions.githubusercontent.com`
4. **Audience:** `sts.amazonaws.com`
5. Click **Add provider**.

### 6.2 Create the IAM Role
1. Open **IAM → Roles → Create role → Custom trust policy** (replace `<ACCOUNT_ID>` and `<GITHUB_ORG>/<REPO_NAME>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<REPO_NAME>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

2. Name the role (e.g., `github-deploy-docker-k8s`) and attach an inline policy with least-privilege permissions for S3 + CloudFront (replace `<ACCOUNT_ID>`, `<FIB1_S3_BUCKET>`, and `<FIB1_CLOUDFRONT_DISTRIBUTION_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SyncFrontendBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::<FIB1_S3_BUCKET>",
        "arn:aws:s3:::<FIB1_S3_BUCKET>/*"
      ]
    },
    {
      "Sid": "InvalidateCloudFront",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<FIB1_CLOUDFRONT_DISTRIBUTION_ID>"
    }
  ]
}
```

*(If you share one IAM role with `multi-container-services-prod`, simply combine this policy with the ECS/ECR/S3/CloudFront statements from [`multi-container-services-prod/AWS.md`](../multi-container-services-prod/AWS.md).)*

---

## 7. Add GitHub Repository Variables & Secrets

### Repository Variables (`Settings → Secrets and variables → Actions → Variables`)

| Variable Name | Required | Example Value |
| :--- | :--- | :--- |
| `AWS_REGION` | Yes | `ap-south-1` (or `us-east-1`) |
| `AWS_OIDC_ROLE_ARN` | Yes | `arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-docker-k8s` |
| `FIB1_S3_BUCKET` | Yes | `fib1-techtoday-click-frontend` |
| `FIB1_CLOUDFRONT_DISTRIBUTION_ID` | Yes | `E1234567890ABC` |

### Repository Secrets (`Settings → Secrets and variables → Actions → Secrets`)

| Secret Name | Required | Value |
| :--- | :--- | :--- |
| `EC2_HOST` | Yes | Your EC2 Elastic IP (e.g. `13.232.10.20`) |
| `EC2_SSH_KEY` | Yes | Full contents of your `fib1-ec2-key.pem` private key |

---

## Estimated Monthly Cost

| Resource | Approx. Monthly Cost |
| :--- | :--- |
| EC2 `t4g.micro` + 20 GB `gp3` + Elastic IP (attached) | ~\$7–9 *(Free Tier eligible)* |
| S3 + CloudFront + ACM | ~\$0–1 |
| **Total** | **~\$8–10/month** |

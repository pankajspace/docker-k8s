# AWS Setup Checklist (`client-server-prod`)

A complete reference of every resource and configuration required on **AWS** for:
- **Frontend:** `https://fib1.techtoday.click` (S3 + CloudFront + ACM)
- **Backend:** `https://api.fib1.techtoday.click` (EC2 + Elastic IP + Caddy Auto-HTTPS)
- **CI/CD:** IAM user for GitHub Actions (`.github/workflows/client-server-prod.yml`)

---

## Services Overview

| AWS Service | Region | Purpose |
| :--- | :--- | :--- |
| **Amazon S3** | Your preferred region (e.g. `ap-south-1` / `us-east-1`) | Private bucket storing compiled React SPA (`client/dist/`) |
| **AWS ACM** | **`us-east-1` (mandatory)** | Free public TLS certificate for `fib1.techtoday.click` |
| **Amazon CloudFront** | Global | HTTPS CDN in front of S3 with OAC + SPA fallback routing |
| **Amazon EC2 + Elastic IP** | Your preferred region | Single Linux VM running Docker (`api` + `caddy`) for `api.fib1.techtoday.click` |
| **Route 53** *(or external DNS)* | Global | DNS records for `fib1.techtoday.click` and `api.fib1.techtoday.click` |
| **AWS IAM** | Global | Least-privilege deploy credentials for GitHub Actions |

---

## 1. AWS Certificate Manager (ACM) — **`us-east-1` Only**

> **Critical:** CloudFront only accepts certificates issued in **`us-east-1` (N. Virginia)**. Switch your AWS Console region to `us-east-1` before creating this certificate.

1. Open **ACM → Request a certificate → Request a public certificate**.
2. **Fully qualified domain name:** `fib1.techtoday.click`
3. **Validation method:** **DNS validation**
4. Create the CNAME validation record shown by ACM in Route 53 (one-click **Create records in Route 53**) or your external DNS provider.
5. Wait until **Status = Issued** (usually 1–5 minutes).

*(Note: You do **not** need an ACM certificate for `api.fib1.techtoday.click` — Caddy automatically provisions and renews Let's Encrypt TLS on EC2.)*

---

## 2. Amazon S3 (Frontend Static Storage)

1. Open **S3 → Create bucket**.
2. **Bucket name:** `fib1-techtoday-click-client` (globally unique).
3. **Object Ownership:** ACLs disabled (recommended).
4. **Block Public Access:** keep **Block all public access = ON**.
5. **Static website hosting:** keep **Disabled** (CloudFront will access objects privately via OAC).
6. After creating the CloudFront distribution in Step 3, paste the CloudFront-generated **Bucket Policy** under **Permissions → Bucket policy**.

---

## 3. Amazon CloudFront (Frontend CDN & HTTPS)

1. Open **CloudFront → Create distribution**.
2. **Origin:**
   - **Origin domain:** `fib1-techtoday-click-client.s3.<region>.amazonaws.com`
   - **Origin access:** **Origin access control settings (recommended)** → **Create new OAC** (Sign requests = enabled).
3. **Default cache behavior:**
   - **Viewer protocol policy:** `Redirect HTTP to HTTPS`
   - **Allowed HTTP methods:** `GET, HEAD`
   - **Cache policy:** `CachingOptimized`
4. **Web Application Firewall (WAF):** Do not enable (to avoid extra monthly cost unless needed).
5. **Settings:**
   - **Alternate domain name (CNAME):** `fib1.techtoday.click`
   - **Custom SSL certificate:** select your `us-east-1` ACM cert for `fib1.techtoday.click`
   - **Default root object:** `index.html`
6. Click **Create distribution**, then click **Copy policy** from the S3 banner and apply it to your S3 bucket policy.
7. **SPA Routing (required for `/otherpage`):**
   - Go to the distribution → **Error pages → Create custom error response**:
     - `403: Forbidden` → Customize = **Yes**, Response page path = `/index.html`, HTTP Response code = `200`
     - `404: Not Found` → Customize = **Yes**, Response page path = `/index.html`, HTTP Response code = `200`
8. Note down:
   - **Distribution ID** (e.g. `E1234567890ABC`) → needed for GitHub `CLOUDFRONT_DISTRIBUTION_ID`
   - **Distribution domain name** (e.g. `d111111abcdef8.cloudfront.net`) → needed for DNS

---

## 4. Amazon EC2 & Elastic IP (Backend API + Caddy)

### 4.1 Launch Instance
- **AMI:** Ubuntu 24.04 LTS (or Amazon Linux 2023)
- **Instance type:** `t3.micro` or `t4g.micro` (Free Tier–eligible; 1 vCPU / 1 GB RAM is plenty)
- **Key pair:** Create or select an SSH key pair (`.pem`) — you'll use this for initial SSH and GitHub `EC2_SSH_KEY`
- **Storage:** 8–20 GB `gp3`

### 4.2 Elastic IP
1. Open **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address**.
2. Select the Elastic IP → **Actions → Associate Elastic IP address** → choose your EC2 instance.
3. Note the static IPv4 address (e.g. `x.x.x.x`).

### 4.3 Security Group Inbound Rules

| Type | Protocol | Port | Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP** | TCP | `80` | `0.0.0.0/0` | Caddy Let's Encrypt ACME HTTP-01 challenge + HTTPS redirect |
| **HTTPS** | TCP | `443` | `0.0.0.0/0` | Production HTTPS API traffic (`api.fib1.techtoday.click`) |
| **Custom UDP** | UDP | `443` | `0.0.0.0/0` | Optional: HTTP/3 (QUIC) support in Caddy |
| **SSH** | TCP | `22` | Your IP *(or `0.0.0.0/0` if deploying via GitHub-hosted runners)* | Admin & GitHub Actions `rsync`/SSH deploy |

> Keep port **`5000` closed** in the Security Group — Express only listens on the private Docker network behind Caddy.

---

## 5. DNS Records (`techtoday.click`)

Configure these records in **Route 53** (or your DNS provider):

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib1.techtoday.click` | **A (Alias)** in Route 53 *or* **CNAME** externally | `<cloudfront-domain>.cloudfront.net` | If using Cloudflare DNS, set to **DNS only (gray cloud)** |
| `api.fib1.techtoday.click` | **A** | `<EC2 Elastic IP>` | Must resolve before starting Caddy so Let's Encrypt succeeds |
| `_xxxx.fib1.techtoday.click` | **CNAME** | `_yyyy.acm-validations.aws.` | Auto-generated by ACM for certificate validation & renewal (keep permanently) |

---

## 6. AWS IAM (For GitHub Actions Frontend Deploys)

Create a dedicated least-privilege IAM user (e.g. `github-deploy-fib1`) with **Programmatic access (Access Key)** and attach this inline policy (replace `<ACCOUNT_ID>`, `<BUCKET_NAME>`, and `<DISTRIBUTION_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::<BUCKET_NAME>"
    },
    {
      "Sid": "S3ObjectSync",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::<BUCKET_NAME>/*"
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
    }
  ]
}
```

Save the generated `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` into your GitHub repository Secrets (see [DEPLOY.md](./DEPLOY.md#part-3--automated-deployments-with-github-actions)).

---

## 7. Estimated Monthly Cost (Low Traffic)

| Resource | Estimated Cost |
| :--- | :--- |
| **S3** (< 1 GB static files) | ~\$0.02 / mo |
| **CloudFront** (1 TB/mo free tier) | \$0.00 / mo |
| **ACM Certificate** | \$0.00 / mo |
| **EC2 `t3.micro` / `t4g.micro`** | Free Tier (first 12 mo) or ~\$6–8 / mo |
| **Elastic IP** (attached to running EC2) | ~\$3.60 / mo (AWS public IPv4 charge) |
| **Route 53 Hosted Zone** *(if using Route 53)* | \$0.50 / mo |

---

## 8. Teardown Checklist (If You Want to Delete Everything Later)

To avoid lingering AWS charges, delete in this order:
1. **CloudFront:** Disable distribution → wait for status `Deployed` → Delete.
2. **S3:** Empty bucket → Delete bucket.
3. **EC2:** Terminate instance → **Release Elastic IP** (unattached Elastic IPs still incur charges!).
4. **DNS:** Remove `fib1.techtoday.click`, `api.fib1.techtoday.click`, and the ACM validation CNAME.
5. **ACM (`us-east-1`):** Delete the certificate.
6. **IAM:** Delete the `github-deploy-fib1` user.

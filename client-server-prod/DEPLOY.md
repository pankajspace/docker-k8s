# AWS Deployment Guide (`client-server-prod`)

This guide walks through deploying **client-server-prod** to AWS with your custom domains:
- **Frontend:** `https://fib1.techtoday.click` → **S3 + CloudFront + ACM (`us-east-1`)**
- **Backend:** `https://api.fib1.techtoday.click` → **EC2 + Docker Compose + Caddy (Auto-HTTPS)**

---

## Prerequisites

- An AWS account with permissions for **EC2**, **S3**, **CloudFront**, **ACM**, and **Route 53** (or your DNS provider for `techtoday.click`).
- Local tools: **Node.js 20+** and **AWS CLI v2** (`aws configure`).

---

## Part 1 — Deploy the Backend API on EC2 (`api.fib1.techtoday.click`)

### 1.1 Launch EC2 & Allocate an Elastic IP

1. Launch an EC2 instance (e.g., `t3.micro` or `t4g.micro`, **Ubuntu 24.04 LTS** or **Amazon Linux 2023**).
2. Allocate an **Elastic IP** and associate it with the EC2 instance so the IP stays fixed across restarts.
3. Configure the EC2 **Security Group** inbound rules:
   - **HTTP (`80`)** from `0.0.0.0/0` (needed by Caddy for HTTP→HTTPS redirect & Let's Encrypt ACME challenge)
   - **HTTPS (`443`)** TCP & UDP from `0.0.0.0/0` (HTTPS + HTTP/3)
   - **SSH (`22`)** from **My IP** (and GitHub Actions runner if using SSH deploys)
   - Do **not** open port `5000` publicly—`api` stays private inside Docker.

### 1.2 Point DNS for `api.fib1.techtoday.click`

In Route 53 (or your DNS provider for `techtoday.click`), create an **`A` record**:
- **Name:** `api.fib1.techtoday.click`
- **Type:** `A`
- **Value:** `<your EC2 Elastic IP>`

Verify DNS propagation before starting Caddy:
```bash
dig +short api.fib1.techtoday.click
```

### 1.3 Install Docker & Start the API + Caddy Stack on EC2

SSH into your EC2 instance, install Docker + Docker Compose plugin, then clone/copy `client-server-prod`:

```bash
# Ubuntu example: install Docker & Compose plugin
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Log out and log back in (or run `newgrp docker`)
```

Configure environment variables and launch:

```bash
cd client-server-prod/ec2
cp .env.example .env
nano .env
```

Confirm `ec2/.env`:
```env
API_DOMAIN=api.fib1.techtoday.click
CLIENT_ORIGIN=https://fib1.techtoday.click
ACME_EMAIL=admin@techtoday.click
```

Start the production stack:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check logs to confirm Caddy obtained the Let's Encrypt certificate:
```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Test the live HTTPS API:
```bash
curl https://api.fib1.techtoday.click/
# Expected: Hi

curl https://api.fib1.techtoday.click/values
# Expected: {"seenIndexes":[],"calculatedValues":{}}
```

---

## Part 2 — Deploy the Frontend on S3 + CloudFront (`fib1.techtoday.click`)

### 2.1 Request an SSL Certificate in AWS ACM (`us-east-1`)

> **Important:** CloudFront **only** accepts ACM certificates created in **`us-east-1` (N. Virginia)**, even if your S3 bucket and EC2 instance are in another region.

1. Switch the AWS Console region to **`us-east-1`** and open **AWS Certificate Manager (ACM)**.
2. Request a **Public Certificate** for `fib1.techtoday.click`.
3. Choose **DNS validation** and add the CNAME validation record to your DNS provider (in Route 53, click **Create records in Route 53**).
4. Wait until the certificate status is **Issued**.

### 2.2 Create a Private S3 Bucket

1. Create an S3 bucket (e.g., `fib1-techtoday-click-client`) in your preferred region.
2. Keep **Block all public access** **ON** (CloudFront will read from it privately using OAC).
3. Do **not** enable S3 Static Website Hosting.

### 2.3 Create the CloudFront Distribution

1. Open **CloudFront** → **Create distribution**.
2. **Origin domain:** select your S3 bucket (`fib1-techtoday-click-client`).
3. **Origin access:** select **Origin access control settings (recommended)** → create a new OAC.
   - After creating the distribution, click **Copy policy** in the banner and paste it into your S3 bucket's **Bucket Policy**.
4. **Default cache behavior:**
   - Viewer protocol policy: **Redirect HTTP to HTTPS**
   - Cache policy: **CachingOptimized**
5. **Settings:**
   - **Alternate domain name (CNAME):** `fib1.techtoday.click`
   - **Custom SSL certificate:** select your `us-east-1` ACM certificate for `fib1.techtoday.click`.
   - **Default root object:** `index.html`
6. **SPA Routing (required for `/otherpage`):**
   - Open your distribution → **Error pages** → **Create custom error response**:
     - HTTP error code `403` → Customize error response **Yes** → Response page path `/index.html` → HTTP Response code `200`
     - HTTP error code `404` → Customize error response **Yes** → Response page path `/index.html` → HTTP Response code `200`

### 2.4 Point DNS for `fib1.techtoday.click` to CloudFront

Because `fib1.techtoday.click` is a subdomain, either of these works cleanly:
- **Route 53:** Create an **`A` record (Alias)** for `fib1.techtoday.click` → **Alias to CloudFront distribution** → select your distribution.
- **External DNS (Cloudflare, Namecheap, GoDaddy, etc.):** Create a **`CNAME`** record for `fib1.techtoday.click` → `dxxxxxxxx.cloudfront.net` (if using Cloudflare, set proxy status to **DNS only / gray cloud** so CloudFront handles TLS).

### 2.5 Build & Upload the React Client

From your local machine:

```bash
cd client-server-prod/client
npm ci
VITE_API_URL=https://api.fib1.techtoday.click npm run build
```

Sync `dist/` to S3 and invalidate CloudFront cache:

```bash
aws s3 sync dist/ s3://fib1-techtoday-click-client --delete
aws cloudfront create-invalidation \
  --distribution-id <YOUR_CLOUDFRONT_DISTRIBUTION_ID> \
  --paths "/*"
```

Open `https://fib1.techtoday.click` in your browser, submit a Fibonacci index (e.g., `7`), and verify `/otherpage` also loads on direct refresh.

---

## Part 3 — Automated Deployments with GitHub Actions

The workflow [`.github/workflows/client-server-prod.yml`](../.github/workflows/client-server-prod.yml) deploys both the frontend (S3 + CloudFront) and backend (EC2 + Caddy) automatically on pushes to `main` touching `client-server-prod/**`, or manually via **Actions → Deploy client-server-prod → Run workflow** (choosing `both`, `client`, or `server`).

In your GitHub repository, go to **Settings → Secrets and variables → Actions** and configure:

### Repository Variables (`Vars`)

| Variable | Value | Description |
| :--- | :--- | :--- |
| `AWS_REGION` | `us-east-1` (or your bucket's region) | Region of your S3 bucket |
| `S3_BUCKET` | `fib1-techtoday-click-client` | Target private S3 bucket name |
| `CLOUDFRONT_DISTRIBUTION_ID` | `<your-distribution-id>` | CloudFront distribution ID to invalidate |
| `VITE_API_URL` | `https://api.fib1.techtoday.click` | Production API URL baked into the Vite bundle |

### Repository Secrets (`Secrets`)

| Secret | Example | Description |
| :--- | :--- | :--- |
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user key with S3 (`PutObject`, `DeleteObject`, `ListBucket`) and CloudFront (`CreateInvalidation`) permissions |
| `AWS_SECRET_ACCESS_KEY` | `...` | Corresponding IAM secret key |
| `EC2_HOST` | `api.fib1.techtoday.click` (or Elastic IP) | EC2 hostname or Elastic IP |
| `EC2_USER` | `ubuntu` or `ec2-user` | SSH username on EC2 |
| `EC2_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Private SSH key authorized on EC2 (`~/.ssh/authorized_keys`) |

> **Note:** Create `~/client-server-prod/ec2/.env` once on the EC2 instance (copied from `ec2/.env.example`). The workflow excludes `.env` during `rsync` so your EC2 environment file is preserved on every deploy.

---

## Updating Production Manually

- **Frontend update:**
  ```bash
  cd client-server-prod/client
  VITE_API_URL=https://api.fib1.techtoday.click npm run build
  aws s3 sync dist/ s3://fib1-techtoday-click-client --delete
  aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
  ```
- **Backend update (on EC2):**
  ```bash
  cd client-server-prod/ec2
  git pull
  docker compose -f docker-compose.prod.yml up -d --build
  ```

---

## Troubleshooting

- **Caddy fails to issue TLS certificate:** Verify `dig +short api.fib1.techtoday.click` returns your EC2 Elastic IP and that EC2 Security Group allows inbound TCP `80` and `443` from `0.0.0.0/0`.
- **CORS error in browser console:** Ensure `CLIENT_ORIGIN=https://fib1.techtoday.click` is set in `ec2/.env` (exact origin, no trailing slash), then run `docker compose -f docker-compose.prod.yml up -d`.
- **403 / 404 on refreshing `/otherpage`:** Confirm CloudFront custom error responses map both `403` and `404` to `/index.html` with HTTP status `200`.
- **Frontend still calling `http://localhost:5000`:** `VITE_API_URL` is baked in at build time—rebuild with `VITE_API_URL=https://api.fib1.techtoday.click npm run build`, re-sync to S3, and run a CloudFront invalidation.

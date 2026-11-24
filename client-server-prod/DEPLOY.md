# Deploying `client-server-prod` to AWS

Complete the manual AWS Console setup in **[AWS.md](./AWS.md)** first (ACM certificate in `us-east-1`, S3 bucket + CloudFront distribution, EC2 instance + Elastic IP, and DNS records).

---

## Prerequisites (For Manual Local Deploys)

- **Node.js 22+** and **npm**
- **AWS CLI v2** authenticated (`aws login` or `aws configure sso`) — verify with `aws sts get-caller-identity`
- **`ssh`** and **`rsync`** with your EC2 `.pem` private key

---

## 1. Build & Deploy the React Frontend (S3 + CloudFront)

```bash
cd client-server-prod/client
npm ci
VITE_API_URL=https://api.fib1.techtoday.click npm run build

export FIB1_S3_BUCKET="<your-s3-bucket-name>"
export FIB1_CLOUDFRONT_DISTRIBUTION_ID="<your-cloudfront-distribution-id>"

# Upload hashed assets with long-lived immutable caching
aws s3 sync dist/ "s3://${FIB1_S3_BUCKET}/" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

# Upload index.html with no-cache so new releases take effect immediately
aws s3 cp dist/index.html "s3://${FIB1_S3_BUCKET}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id "${FIB1_CLOUDFRONT_DISTRIBUTION_ID}" \
  --paths "/*"
```

---

## 2. Deploy the Backend Containers to EC2

Wait ~60–90 seconds after initial EC2 launch for the User Data script to finish installing Docker, Docker Compose v2, `rsync`, and `~/client-server-prod/ec2/.env`.

*(If you did not use the User Data script, SSH into EC2, install `docker`, `docker-compose`, and `rsync`, and copy `ec2/.env.example` to `~/client-server-prod/ec2/.env` with your production values.)*

Sync the backend code and start the containers:

```bash
export EC2_IP="<your-ec2-elastic-ip>"
export SSH_KEY="/path/to/fib1-ec2-key.pem"

ssh -i "$SSH_KEY" "ec2-user@${EC2_IP}" \
  "mkdir -p ~/client-server-prod/server ~/client-server-prod/ec2"

rsync -avz --delete --exclude 'node_modules' --exclude '.env' -e "ssh -i $SSH_KEY" \
  client-server-prod/server/ "ec2-user@${EC2_IP}:~/client-server-prod/server/"

rsync -avz --delete --exclude '.env' -e "ssh -i $SSH_KEY" \
  client-server-prod/ec2/ "ec2-user@${EC2_IP}:~/client-server-prod/ec2/"

ssh -i "$SSH_KEY" "ec2-user@${EC2_IP}" \
  "cd ~/client-server-prod/ec2 && docker compose -f docker-compose.prod.yml up -d --build && docker image prune -f"
```

---

## 3. Verify

```bash
curl -i https://api.fib1.techtoday.click/
```

Open **`https://fib1.techtoday.click`** in your browser and test submitting an index.

To inspect container logs on EC2:

```bash
ssh -i "$SSH_KEY" "ec2-user@${EC2_IP}" \
  "cd ~/client-server-prod/ec2 && docker compose -f docker-compose.prod.yml logs -f"
```

---

## 4. Automated CI/CD (GitHub Actions)

Once you configure the GitHub Repository Variables and Secrets listed in **[AWS.md](./AWS.md#7-add-github-repository-variables--secrets)**, pushing to `main` (touching `client-server-prod/**`) or triggering [`.github/workflows/client-server-prod.yml`](../.github/workflows/client-server-prod.yml) via **workflow_dispatch** will automatically:

1. Build the React app, sync `client/dist/` to S3, and invalidate CloudFront (`deploy-client`).
2. Validate `server/index.js`, `rsync` `server/` and `ec2/` to EC2, and rebuild/restart Docker Compose (`deploy-server`).

---

## 5. Manual Teardown (Avoid Ongoing Charges)

Delete resources in the AWS Console in this order:

1. **CloudFront:** Disable and delete the distribution.
2. **S3:** Empty and delete the frontend bucket.
3. **EC2:** Terminate the `fib1-api-ec2` instance.
4. **Elastic IP:** Disassociate and **Release** the Elastic IP (unattached Elastic IPs incur hourly charges).
5. **Security Group & Key Pair:** Delete `fib1-api-ec2-sg` and `fib1-ec2-key` (optional).
6. **DNS & ACM:** Remove DNS records for `fib1.techtoday.click` and `api.fib1.techtoday.click`, and delete the ACM certificate in `us-east-1` if no longer needed.

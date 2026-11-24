# Deploying `multi-container-services-prod` to AWS

Complete the manual AWS Console setup in **[AWS.md](./AWS.md)** first (ACM cert, VPC, Security Groups, RDS, ElastiCache Valkey, ECR, ALB, ECS Cluster/Services, S3 + CloudFront, and DNS).

---

## Prerequisites (For Manual Local Deploys)

- **Node.js 22+** and **npm**
- **Docker** running locally (with `docker buildx` support for building `linux/amd64` images on Apple Silicon)
- **AWS CLI v2** authenticated (`aws login` or `aws configure sso`) — verify with:
  ```bash
  aws sts get-caller-identity
  ```

---

## 1. Build & Deploy the Frontend (S3 + CloudFront)

```bash
cd multi-container-services-prod/client
npm ci
npm run build

export FIB2_S3_BUCKET="<your-s3-bucket-name>"
export FIB2_CLOUDFRONT_DISTRIBUTION_ID="<your-cloudfront-distribution-id>"

# Upload hashed assets with long-lived immutable caching
aws s3 sync dist/ "s3://${FIB2_S3_BUCKET}/" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

# Upload index.html with no-cache so new releases take effect immediately
aws s3 cp dist/index.html "s3://${FIB2_S3_BUCKET}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id "${FIB2_CLOUDFRONT_DISTRIBUTION_ID}" \
  --paths "/*"
```

---

## 2. Build & Push Container Images to ECR

Set your AWS account ID, region, and ECR repository names:

```bash
export AWS_REGION="ap-south-1"
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_TAG=$(git rev-parse --short HEAD)

# Authenticate Docker to Amazon ECR
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Build & push API image (linux/amd64 for ECS Fargate X86_64)
docker build --platform linux/amd64 \
  -t "${ECR_REGISTRY}/fib2-api:${IMAGE_TAG}" \
  -t "${ECR_REGISTRY}/fib2-api:latest" \
  multi-container-services-prod/server
docker push "${ECR_REGISTRY}/fib2-api:${IMAGE_TAG}"
docker push "${ECR_REGISTRY}/fib2-api:latest"

# Build & push Worker image (linux/amd64 for ECS Fargate X86_64)
docker build --platform linux/amd64 \
  -t "${ECR_REGISTRY}/fib2-worker:${IMAGE_TAG}" \
  -t "${ECR_REGISTRY}/fib2-worker:latest" \
  multi-container-services-prod/worker
docker push "${ECR_REGISTRY}/fib2-worker:${IMAGE_TAG}"
docker push "${ECR_REGISTRY}/fib2-worker:latest"
```

---

## 3. Trigger Rolling ECS Fargate Deployments

Because the `fib2-api` and `fib2-worker` task definitions reference `:latest`, forcing a new deployment pulls the newly pushed images and rolls out tasks with zero downtime:

```bash
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster fib2-cluster \
  --service fib2-api-service \
  --force-new-deployment

aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster fib2-cluster \
  --service fib2-worker-service \
  --force-new-deployment

# Wait for both services to stabilize
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster fib2-cluster \
  --services fib2-api-service fib2-worker-service
```

---

## 4. Verify

```bash
curl -i https://fib2.techtoday.click/api/values/all
```

Open **`https://fib2.techtoday.click`** in your browser and submit an index. Refresh the page to verify that the value was computed by the `worker` via Valkey Pub/Sub and persisted in RDS PostgreSQL.

---

## 5. Production Hardening Checklist

Before running real production traffic, tighten these starter defaults in the AWS Console:

- **VPC NAT Gateways:** Deploy 1 NAT Gateway per AZ (2 total) for Multi-AZ high availability.
- **RDS PostgreSQL:** Enable **Multi-AZ**, **Deletion protection**, and final snapshots.
- **ECS Fargate:** Increase `desiredCount` to `2`+ on `fib2-api-service` (and optionally `fib2-worker-service`) and attach CPU/memory target-tracking auto scaling.
- **Immutable Image Tags:** For strict release traceability, pin task definition revisions to `${IMAGE_TAG}` instead of `:latest`.

---

## 6. Automated CI/CD (GitHub Actions)

Once you configure the GitHub Repository Variables listed in **[AWS.md](./AWS.md#10-add-github-repository-variables)**, pushing to `main` (touching `multi-container-services-prod/**`) or manually running [`.github/workflows/multi-container-services-prod.yml`](../.github/workflows/multi-container-services-prod.yml) via **workflow_dispatch** will automatically:

1. Build the React SPA, sync `client/dist/` to S3, and invalidate CloudFront (`deploy-client`).
2. Validate `server/` and `worker/` syntax, build and push `linux/amd64` images to ECR, trigger rolling ECS Fargate deployments, and wait for service stability (`deploy-services`).

---

## 7. Estimated Monthly Cost (Starter Defaults, `us-east-1`)

| Resource | Approx. Monthly Cost |
| :--- | :--- |
| 1x NAT Gateway | ~\$32 |
| Application Load Balancer | ~\$16–20 |
| RDS PostgreSQL (`db.t4g.micro`, 20 GB) | ~\$15 *(eligible for new-account AWS Free Tier credits)* |
| ECS Fargate (2x 0.25 vCPU / 0.5 GB tasks) | ~\$18 |
| ElastiCache for Valkey Serverless (100 MB floor) | ~\$6+ |
| S3 + CloudFront + Secrets Manager + ECR + CloudWatch | ~\$1–3 |
| **Total (running 24/7)** | **~\$90–95/month** |

---

## 8. Manual Teardown (Avoid Ongoing Charges)

Delete resources in this order to avoid dependency errors:

1. **CloudFront:** Disable and delete the distribution.
2. **S3:** Empty and delete `fib2-techtoday-click-frontend`.
3. **ECS:** Delete `fib2-api-service` and `fib2-worker-service` (scale to 0 or force delete), then delete `fib2-cluster`.
4. **ALB & Target Group:** Delete `fib2-api-alb`, then delete `fib2-api-tg`.
5. **RDS:** Delete `fib2-postgres` (uncheck final snapshot if not needed) and delete `fib2-rds-subnets`.
6. **ElastiCache:** Delete `fib-valkey-serverless` and delete `fib2-valkey-subnets`.
7. **ECR:** Delete `fib2-api` and `fib2-worker` repositories.
8. **VPC & NAT Gateway:** Delete the NAT Gateway, **Release its Elastic IP**, then delete `fib2-vpc` (which cleans up subnets, route tables, IGW, and security groups).
9. **DNS, Logs & ACM:** Remove the `fib2.techtoday.click` DNS record, delete CloudWatch log groups, and delete the `us-east-1` ACM certificate if no longer needed.

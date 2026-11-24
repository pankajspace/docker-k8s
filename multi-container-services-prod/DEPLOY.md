# Deploying `multi-container-services-prod` to AWS

This guide covers deploying the full stack (VPC, RDS for PostgreSQL, ElastiCache for Valkey Serverless, ECS Fargate `api` + `worker`, ALB, S3, and CloudFront) using **AWS CDK (TypeScript)**.

---

## Prerequisites

- **Node.js 22+** and **npm**
- **Docker** running locally (CDK builds and pushes the `server/` and `worker/` container images to ECR during `cdk deploy`)
- **AWS CLI v2** authenticated (`aws login` or `aws configure sso`) — verify with:
  ```bash
  aws sts get-caller-identity
  ```

---

## 1. Request an ACM Certificate in `us-east-1` (Mandatory for CloudFront)

> **Critical:** CloudFront only accepts TLS certificates issued in **`us-east-1` (N. Virginia)**, even if you deploy your ECS/RDS stack to another region (e.g., `ap-south-1`).

1. Open **AWS Certificate Manager (ACM)** in **`us-east-1`** → **Request a public certificate**.
2. **Fully qualified domain name:** `fib2.techtoday.click`
3. **Validation method:** **DNS validation** — add the CNAME validation record in Route 53 (or your DNS provider) and wait until **Status = Issued**.
4. Copy the certificate ARN (e.g. `arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<UUID>`).

---

## 2. Build the Frontend Static Bundle

CDK deploys `client/dist/` to S3 and invalidates CloudFront automatically, so build the React bundle first:

```bash
cd multi-container-services-prod/client
npm ci
npm run build
```

---

## 3. Install CDK Dependencies & Bootstrap (One-Time per Account/Region)

```bash
cd ../infra
npm ci
npx cdk bootstrap
```

*(If deploying to a specific account/region, run `npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>`.)*

---

## 4. Preview & Deploy with CDK

Export your `us-east-1` ACM certificate ARN (and optionally `ROUTE53_HOSTED_ZONE_ID` if `techtoday.click` is hosted in Route 53 so CDK creates the A/AAAA Alias records automatically):

```bash
export ACM_CERTIFICATE_ARN="arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<UUID>"
# Optional — only if techtoday.click is in Route 53:
# export ROUTE53_HOSTED_ZONE_ID="ZXXXXXXXXXXXXX"

npm run typecheck
npm run synth
npm run diff
npm run deploy
```

> **Note:** First deployment typically takes **10–15 minutes** (RDS PostgreSQL + CloudFront distribution creation). Never use `--hotswap` or `--express` for production deployments.

### Point DNS to CloudFront (if not using Route 53 auto-records)

When `cdk deploy` finishes, copy the **`CloudFrontDomainName`** output (e.g., `d1234abcd.cloudfront.net`) and create this record in your DNS provider for `techtoday.click`:

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib2.techtoday.click` | **A (Alias)** in Route 53 *or* **CNAME** externally | `<CloudFrontDomainName>` | If using Cloudflare DNS, set to **DNS only (gray cloud)** |

Then open **`https://fib2.techtoday.click`** in your browser.

---

## 5. Production Hardening Checklist

The stack defaults are tuned so a starter/learning deployment is easy to tear down and keeps costs moderate. Before running real production traffic, update `infra/lib/multi-container-services-prod-stack.ts`:

- **VPC NAT Gateways:** Increase `natGateways: 1` -> `2` for Multi-AZ high availability.
- **RDS PostgreSQL:** Set `multiAz: true`, `deletionProtection: true`, and `removalPolicy: cdk.RemovalPolicy.SNAPSHOT`.
- **ECS Fargate:** Set `desiredCount: 2` on `ApiService` (and optionally `WorkerService`) and attach target-tracking auto scaling.

---

## 6. GitHub Actions CI/CD (AWS OIDC)

The workflow at [`.github/workflows/multi-container-services-prod.yml`](../.github/workflows/multi-container-services-prod.yml) deploys automatically on pushes to `main` (or via manual **workflow_dispatch**) using **GitHub OIDC** (no static AWS access keys).

### Setup Steps
1. Create an **IAM OIDC Identity Provider** in AWS for `https://token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
2. Create an **IAM Role** trusted by your repository (`repo:<ORG>/<REPO>:ref:refs/heads/main`) with permissions to assume the CDK bootstrap roles (`sts:AssumeRole` on `arn:aws:iam::<ACCOUNT_ID>:role/cdk-*`).
3. Add the following **Repository Variables** in GitHub (`Settings -> Secrets and variables -> Actions -> Variables`):
   - `AWS_REGION` — e.g. `ap-south-1` or `us-east-1`
   - `AWS_OIDC_ROLE_ARN` — ARN of the IAM role created above
   - `ACM_CERTIFICATE_ARN` — ARN of the issued `us-east-1` ACM cert for `fib2.techtoday.click`
   - `ROUTE53_HOSTED_ZONE_ID` *(optional)* — Route 53 Hosted Zone ID for `techtoday.click`

---

## 7. Estimated Monthly Cost (Starter Defaults, `us-east-1`)

| Resource | Approx. Monthly Cost |
| :--- | :--- |
| 1x NAT Gateway | ~\$32 |
| Application Load Balancer | ~\$16–20 |
| RDS PostgreSQL (`db.t4g.micro`, 20 GB) | ~\$15 *(eligible for new-account AWS Free Tier credits)* |
| ECS Fargate (2x 0.25 vCPU / 0.5 GB tasks) | ~\$18 |
| ElastiCache for Valkey Serverless (100 MB floor) | ~\$6+ |
| S3 + CloudFront + Secrets Manager + CloudWatch | ~\$1–3 |
| **Total (running 24/7)** | **~\$90–95/month** |

---

## 8. Teardown (Avoid Ongoing Charges)

To delete all AWS resources created by the stack (including the S3 bucket, RDS instance, ElastiCache cache, ECS services, ALB, and VPC):

```bash
cd multi-container-services-prod/infra
npm run destroy
```

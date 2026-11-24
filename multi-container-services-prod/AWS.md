# Manual AWS Console Setup Guide (`multi-container-services-prod`)

Follow this step-by-step guide to provision all AWS resources manually in the AWS Console before deploying locally or via GitHub Actions ([`.github/workflows/multi-container-services-prod.yml`](../.github/workflows/multi-container-services-prod.yml)).

---

## Resources You Will Create

| Resource | Region | Purpose |
| :--- | :--- | :--- |
| **ACM Certificate** | `us-east-1` *(required)* | TLS certificate for `fib2.techtoday.click` on CloudFront |
| **VPC + 6 Subnets + 1 NAT GW** | Target region | 3-tier network (Public, Private App, Isolated Data across 2 AZs) |
| **5 Security Groups** | Target region | Least-privilege traffic between ALB, API, Worker, RDS, and Valkey |
| **RDS PostgreSQL 16 + Secrets Manager** | Target region | Persistent store for submitted indexes (`fibdb`) |
| **ElastiCache for Valkey Serverless** | Target region | TLS-encrypted cache and Pub/Sub broker |
| **2 ECR Repositories** | Target region | Container registries for `fib2-api` and `fib2-worker` |
| **ALB + Target Group** | Target region | Routes CloudFront `/api/*` requests (with `X-Origin-Verify`) to `api:5000` |
| **ECS Cluster + 2 Fargate Services** | Target region | Runs `api` and `worker` containers in private subnets |
| **S3 Bucket + CloudFront Distribution** | Target region / Global | Single-origin HTTPS delivery for SPA (`/*`) and API (`/api/*`) |
| **GitHub OIDC Provider + IAM Role** | Global (IAM) | Passwordless CI/CD deploys to S3, CloudFront, ECR, and ECS |

---

## 1. Request an ACM Certificate in `us-east-1` (Mandatory)

> **Critical:** CloudFront **only** accepts certificates issued in **`us-east-1` (N. Virginia)**, even if your VPC/ECS/RDS stack lives in another region (e.g., `ap-south-1`).

1. Switch the AWS Console region to **`us-east-1` (N. Virginia)**.
2. Open **ACM → Request a certificate → Request a public certificate**.
3. **Fully qualified domain name:** `fib2.techtoday.click`
4. **Validation method:** **DNS validation** → click **Request**.
5. Add the validation CNAME record to your DNS provider for `techtoday.click` (keep it permanently for auto-renewal) and wait until **Status = Issued**.

---

## 2. Create VPC & Security Groups (Target Region)

Switch the AWS Console to your target deployment region (e.g., `ap-south-1` or `us-east-1`).

### 2.1 Create the VPC
1. Open **VPC → Create VPC → VPC and more**:
   - **Name tag:** `fib2-vpc`
   - **IPv4 CIDR block:** `10.0.0.0/16`
   - **Number of Availability Zones (AZs):** `2`
   - **Number of public subnets:** `2` *(for ALB & NAT Gateway)*
   - **Number of private subnets:** `4` *(2 for Private App/ECS with NAT egress, 2 for Isolated Data/RDS+Valkey — or create 2 private subnets with NAT and add 2 isolated subnets without NAT afterward)*
   - **NAT gateways:** `1 per AZ` for HA, or **`In 1 AZ`** to save ~\$32/month
   - **VPC endpoints:** None (optional: S3 Gateway endpoint is free and saves NAT data transfer)
2. Click **Create VPC**.

### 2.2 Create Least-Privilege Security Groups
Create 5 Security Groups inside `fib2-vpc`:

| Security Group Name | Inbound Rules | Outbound Rules |
| :--- | :--- | :--- |
| `fib2-alb-sg` | TCP `80` from `0.0.0.0/0` *(CloudFront to ALB; enforced by `X-Origin-Verify` header)* | Allow all (`0.0.0.0/0`) |
| `fib2-api-sg` | TCP `5000` from `fib2-alb-sg` | Allow all (`0.0.0.0/0`) |
| `fib2-worker-sg` | *None* | Allow all (`0.0.0.0/0`) |
| `fib2-rds-sg` | TCP `5432` from `fib2-api-sg` | *None required* |
| `fib2-valkey-sg` | TCP `6379` from `fib2-api-sg` **and** TCP `6379` from `fib2-worker-sg` | *None required* |

---

## 3. Create Managed Data Services

### 3.1 Amazon RDS for PostgreSQL 16
1. Open **RDS → Subnet groups → Create DB subnet group**:
   - Name: `fib2-rds-subnets`, VPC: `fib2-vpc`, select your **2 isolated data subnets** across 2 AZs.
2. Open **RDS → Databases → Create database**:
   - **Creation method:** Standard create
   - **Engine:** PostgreSQL **16**
   - **Templates:** Free tier / Dev/Test (or Production for Multi-AZ)
   - **DB instance identifier:** `fib2-postgres`
   - **Master username:** `postgres`
   - **Credentials management:** **Managed in AWS Secrets Manager** *(recommended — automatically creates a secret with `username` and `password`)*
   - **Instance class:** `db.t4g.micro`
   - **Storage:** `20 GiB` `gp3`, enable storage encryption
   - **Connectivity:** VPC `fib2-vpc`, DB subnet group `fib2-rds-subnets`, **Public access: No**, VPC security group: `fib2-rds-sg`
   - **Additional configuration → Initial database name:** `fibdb`
   - **Backup retention:** `7` days
3. Click **Create database**. Once available, copy:
   - **Endpoint** (e.g. `fib2-postgres.xxxx.region.rds.amazonaws.com`) → `PGHOST`
   - **Master secret ARN** (under *Configuration → Master credentials ARN*) → used in the ECS `api` task definition.

### 3.2 Amazon ElastiCache for Valkey Serverless
1. Open **ElastiCache → Subnet groups → Create subnet group**:
   - Name: `fib2-valkey-subnets`, VPC: `fib2-vpc`, select your **2 isolated data subnets**.
2. Open **ElastiCache → Valkey caches → Create Valkey cache**:
   - **Deployment option:** **Serverless**
   - **Name:** `fib-valkey-serverless`
   - **Usage limits:** Max data storage `1 GB`, Max ECPUs per second `1000`
   - **Connectivity:** VPC `fib2-vpc`, Subnet group `fib2-valkey-subnets`, Security group `fib2-valkey-sg`
   - **Encryption in transit (TLS):** Enabled *(default for Serverless)*
3. Click **Create**. Once available, copy the **Endpoint** (host and port `6379`) → `REDIS_HOST` and `REDIS_PORT`.

---

## 4. Create Amazon ECR Repositories & Push Initial Images

1. Open **ECR → Repositories → Create repository** twice:
   - `fib2-api` (Private)
   - `fib2-worker` (Private)
2. Before creating the ECS services below, build and push the initial `linux/amd64` images to both repositories using the commands in **[DEPLOY.md](./DEPLOY.md#2-build--push-container-images-to-ecr)** so ECS tasks start cleanly on first launch.

---

## 5. Create Application Load Balancer (ALB) & Target Group

Pick a strong random secret string for `X-Origin-Verify` (e.g., run `openssl rand -hex 24`) and save it — you will configure the same value on both the ALB listener rule and CloudFront custom origin header.

### 5.1 Target Group
1. Open **EC2 → Target Groups → Create target group**:
   - **Target type:** **IP addresses** *(required for Fargate `awsvpc`)*
   - **Name:** `fib2-api-tg`
   - **Protocol / Port:** `HTTP` / `5000`
   - **VPC:** `fib2-vpc`
   - **Health check path:** `/health` (Success code `200`, Interval `30s`, Timeout `5s`, Healthy threshold `2`, Unhealthy threshold `3`)
2. Click **Create target group** (do not register targets manually; ECS manages them).
3. Under **Attributes → Edit**, set **Deregistration delay** to `30` seconds.

### 5.2 Application Load Balancer
1. Open **EC2 → Load Balancers → Create load balancer → Application Load Balancer**:
   - **Name:** `fib2-api-alb`
   - **Scheme:** Internet-facing
   - **Network mapping:** `fib2-vpc`, select both **Public subnets**
   - **Security groups:** `fib2-alb-sg`
   - **Listener:** `HTTP:80` → temporarily forward to `fib2-api-tg` (we will lock it down next)
2. Create the ALB, then open **Listeners and rules → HTTP:80**:
   - **Edit default rule:** Change action to **Return fixed response**, status `403`, content type `text/plain`, body `Access denied. Use the CloudFront URL.`
   - **Add rule (Priority `10`):**
     - **Condition:** HTTP header `X-Origin-Verify` equals `<YOUR_ORIGIN_VERIFY_SECRET>`
     - **Action:** Forward to `fib2-api-tg`
3. Copy the ALB **DNS name** (e.g. `fib2-api-alb-123456.ap-south-1.elb.amazonaws.com`).

---

## 6. Create ECS Cluster, IAM Execution Role, Task Definitions & Services

### 6.1 CloudWatch Log Groups
Open **CloudWatch → Logs → Log groups → Create log group**:
- `/ecs/fib2-api` (Retention: `7 days`)
- `/ecs/fib2-worker` (Retention: `7 days`)

### 6.2 ECS Task Execution Role
1. Open **IAM → Roles → Create role → AWS service → Elastic Container Service → Elastic Container Service Task**.
2. Attach AWS managed policy **`AmazonECSTaskExecutionRolePolicy`**.
3. Name it `fib2-ecs-task-execution-role` and create it.
4. Open the role → **Permissions → Add permissions → Create inline policy** (JSON) so ECS can inject the RDS Secrets Manager credentials into the `api` container:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "<RDS_MASTER_SECRET_ARN>"
    }
  ]
}
```

### 6.3 ECS Cluster
1. Open **ECS → Clusters → Create cluster**:
   - **Cluster name:** `fib2-cluster`
   - **Infrastructure:** **AWS Fargate (serverless)**
   - **Monitoring:** Optional Container Insights

### 6.4 Task Definition: `fib2-api`
Open **ECS → Task definitions → Create new task definition**:
- **Family:** `fib2-api`
- **Launch type:** AWS Fargate
- **OS / Architecture:** `Linux/X86_64`
- **CPU / Memory:** `0.25 vCPU` / `0.5 GB`
- **Task execution role:** `fib2-ecs-task-execution-role`
- **Container:**
  - **Name:** `api`
  - **Image URI:** `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/fib2-api:latest`
  - **Port mappings:** Container port `5000`, Protocol `TCP`
  - **Environment variables:**
    - `PORT` = `5000`
    - `CLIENT_ORIGIN` = `https://fib2.techtoday.click`
    - `PGHOST` = `<RDS_ENDPOINT>`
    - `PGPORT` = `5432`
    - `PGDATABASE` = `fibdb`
    - `PGSSL` = `true`
    - `REDIS_HOST` = `<VALKEY_ENDPOINT>`
    - `REDIS_PORT` = `6379`
    - `REDIS_TLS` = `true`
  - **Secrets (ValueFrom = Secrets Manager ARN):**
    - `PGUSER` = `<RDS_MASTER_SECRET_ARN>:username::`
    - `PGPASSWORD` = `<RDS_MASTER_SECRET_ARN>:password::`
  - **HealthCheck:**
    - Command: `CMD-SHELL,wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1`
    - Interval `30`, Timeout `5`, Start period `15`, Retries `3`
  - **Logging:** awslogs → `/ecs/fib2-api`, stream prefix `api`

### 6.5 Task Definition: `fib2-worker`
Open **ECS → Task definitions → Create new task definition**:
- **Family:** `fib2-worker`
- **Launch type:** AWS Fargate, `Linux/X86_64`, `0.25 vCPU` / `0.5 GB`
- **Task execution role:** `fib2-ecs-task-execution-role`
- **Container:**
  - **Name:** `worker`
  - **Image URI:** `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/fib2-worker:latest`
  - **Port mappings:** *None*
  - **Environment variables:**
    - `REDIS_HOST` = `<VALKEY_ENDPOINT>`
    - `REDIS_PORT` = `6379`
    - `REDIS_TLS` = `true`
  - **Logging:** awslogs → `/ecs/fib2-worker`, stream prefix `worker`

### 6.6 Create ECS Services
Inside `fib2-cluster → Services → Create`:

1. **API Service (`fib2-api-service`):**
   - Launch type: Fargate, Task definition: `fib2-api`, Desired tasks: `1`
   - Deployment options: Enable **Deployment circuit breaker** + **Rollback on failures**
   - Networking: `fib2-vpc`, **Private App subnets** (with NAT egress), Security group `fib2-api-sg`, **Public IP: Turned off**
   - Load balancing: **Application Load Balancer** → Use existing ALB `fib2-api-alb` → Use existing listener `80:HTTP` → Use existing target group `fib2-api-tg`, Health check grace period `60` seconds
2. **Worker Service (`fib2-worker-service`):**
   - Launch type: Fargate, Task definition: `fib2-worker`, Desired tasks: `1`
   - Deployment options: Enable **Deployment circuit breaker** + **Rollback on failures**
   - Networking: `fib2-vpc`, **Private App subnets** (with NAT egress), Security group `fib2-worker-sg`, **Public IP: Turned off**
   - Load balancing: **None**

---

## 7. Create Private S3 Bucket & Single-Origin CloudFront Distribution

### 7.1 S3 Bucket
1. Open **S3 → Create bucket**:
   - **Name:** Globally unique name, e.g. `fib2-techtoday-click-frontend` (save for `FIB2_S3_BUCKET`)
   - **Block all public access:** Enabled
   - **Default encryption:** SSE-S3

### 7.2 CloudFront Distribution
1. Open **CloudFront → Distributions → Create distribution**:
   - **Origin 1 (Frontend S3):**
     - Origin domain: `fib2-techtoday-click-frontend`
     - Origin access: **Origin access control (OAC)** → Create new OAC
   - **Default cache behavior (`*`):**
     - Viewer protocol policy: **Redirect HTTP to HTTPS**
     - Cache policy: `CachingOptimized`
   - **Settings:**
     - Alternate domain name (CNAME): `fib2.techtoday.click`
     - Custom SSL certificate: Select your `us-east-1` ACM cert for `fib2.techtoday.click`
     - Default root object: `index.html`
   - Click **Create distribution**, then **copy the OAC bucket policy** and paste it into your S3 bucket's **Permissions → Bucket policy**.
2. **Add Second Origin (ALB for `/api/*`):**
   - Open your distribution → **Origins → Create origin**:
     - Origin domain: `<ALB_DNS_NAME>`
     - Protocol: **HTTP only** (port `80`)
     - **Add custom header:** Header name `X-Origin-Verify`, Value `<YOUR_ORIGIN_VERIFY_SECRET>`
3. **Add `/api/*` Cache Behavior:**
   - Open **Behaviors → Create behavior**:
     - Path pattern: `/api/*`
     - Origin: Select the ALB origin created above
     - Viewer protocol policy: **Redirect HTTP to HTTPS**
     - Allowed HTTP methods: **`GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`**
     - Cache policy: **`CachingDisabled`**
     - Origin request policy: **`AllViewer`**
4. **Add SPA Fallback (Error Pages):**
   - Open **Error pages → Create custom error response** twice:
     - HTTP `403` → Custom response `/index.html`, HTTP `200`, Minimum TTL `0`
     - HTTP `404` → Custom response `/index.html`, HTTP `200`, Minimum TTL `0`
5. Copy:
   - **Distribution ID** (`FIB2_CLOUDFRONT_DISTRIBUTION_ID`)
   - **Distribution domain name** (e.g. `d1234abcd.cloudfront.net`)

---

## 8. Configure DNS Record for `fib2.techtoday.click`

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib2.techtoday.click` | **A / AAAA (Alias)** in Route 53 *or* **CNAME** externally | `<CloudFrontDomainName>` (e.g. `d1234abcd.cloudfront.net`) | Cloudflare: set to **DNS only (gray cloud)** |

---

## 9. Configure GitHub OIDC & IAM Role (For CI/CD)

1. Ensure the GitHub OIDC provider (`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) exists in **IAM → Identity providers**.
2. Create (or reuse) an IAM Role trusted by `repo:<GITHUB_ORG>/<REPO_NAME>:ref:refs/heads/main` and attach this least-privilege inline policy (replace `<ACCOUNT_ID>`, `<REGION>`, `<FIB2_S3_BUCKET>`, `<FIB2_CLOUDFRONT_DISTRIBUTION_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SyncFrontendBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::<FIB2_S3_BUCKET>",
        "arn:aws:s3:::<FIB2_S3_BUCKET>/*"
      ]
    },
    {
      "Sid": "InvalidateCloudFront",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<FIB2_CLOUDFRONT_DISTRIBUTION_ID>"
    },
    {
      "Sid": "EcrAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPushImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": [
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/fib2-api",
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/fib2-worker"
      ]
    },
    {
      "Sid": "EcsDeployServices",
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": [
        "arn:aws:ecs:<REGION>:<ACCOUNT_ID>:service/fib2-cluster/fib2-api-service",
        "arn:aws:ecs:<REGION>:<ACCOUNT_ID>:service/fib2-cluster/fib2-worker-service"
      ]
    }
  ]
}
```

---

## 10. Add GitHub Repository Variables

In GitHub → **Settings → Secrets and variables → Actions → Variables**:

| Variable Name | Required | Example Value |
| :--- | :--- | :--- |
| `AWS_REGION` | Yes | `ap-south-1` (or `us-east-1`) |
| `AWS_OIDC_ROLE_ARN` | Yes | `arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-docker-k8s` |
| `FIB2_S3_BUCKET` | Yes | `fib2-techtoday-click-frontend` |
| `FIB2_CLOUDFRONT_DISTRIBUTION_ID` | Yes | `E1234567890XYZ` |
| `FIB2_ECR_API_REPO` | Yes | `fib2-api` |
| `FIB2_ECR_WORKER_REPO` | Yes | `fib2-worker` |
| `FIB2_ECS_CLUSTER` | Yes | `fib2-cluster` |
| `FIB2_ECS_API_SERVICE` | Yes | `fib2-api-service` |
| `FIB2_ECS_WORKER_SERVICE` | Yes | `fib2-worker-service` |

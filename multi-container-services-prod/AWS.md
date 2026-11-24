# AWS Pre-Push Setup Checklist (`multi-container-services-prod`)

Because **AWS CDK** provisions the application infrastructure automatically, you do **not** need to manually create the VPC, S3 bucket, CloudFront distribution, ALB, ECS cluster, RDS database, or ElastiCache cache.

However, **before pushing to `main`** (which triggers [`.github/workflows/multi-container-services-prod.yml`](../.github/workflows/multi-container-services-prod.yml)), you must complete the **4 one-time prerequisites** below in AWS and GitHub.

---

## Manual Prerequisites vs. CDK-Managed Resources

| Created Manually (Before First Push) | Created Automatically by AWS CDK |
| :--- | :--- |
| **ACM Certificate** (`us-east-1`) for `fib2.techtoday.click` | VPC (Public, Private App, Isolated Data subnets + NAT GW) |
| **CDK Bootstrap** stack (`CDKToolkit`) in your target region | Amazon S3 (private + OAC) & Amazon CloudFront (`https://fib2.techtoday.click`) |
| **GitHub OIDC Provider + IAM Deploy Role** in AWS IAM | Application Load Balancer (with `X-Origin-Verify` protection) |
| **GitHub Repository Variables** (`AWS_REGION`, etc.) | Amazon ECS Cluster + Fargate Services (`api` & `worker`) + ECR assets |
| **External DNS CNAME** *(only if not using Route 53)* | Amazon RDS for PostgreSQL 16 + AWS Secrets Manager credentials |
| | Amazon ElastiCache for Valkey Serverless + CloudWatch Log Groups |
| | Route 53 `A`/`AAAA` Alias records *(if `ROUTE53_HOSTED_ZONE_ID` is set)* |

---

## 1. Request an ACM Certificate in `us-east-1` (Mandatory)

> **Critical:** CloudFront **only** accepts certificates issued in **`us-east-1` (N. Virginia)**, even if you deploy the stack to another region (e.g., `ap-south-1`).

1. Switch the AWS Console region to **`us-east-1` (N. Virginia)**.
2. Open **AWS Certificate Manager (ACM)** → **Request a certificate** → **Request a public certificate**.
3. **Fully qualified domain name:** `fib2.techtoday.click`
4. **Validation method:** **DNS validation** → click **Request**.
5. Open the pending certificate and add the **CNAME name / CNAME value** to your DNS provider for `techtoday.click` (or click **Create records in Route 53** if using Route 53).
   - Keep this validation CNAME permanently so ACM can auto-renew the certificate.
6. Wait until **Status = Issued** (usually 1–5 minutes) and copy the **Certificate ARN**:
   ```text
   arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<CERT_UUID>
   ```

---

## 2. Bootstrap AWS CDK in Your Target Region (One-Time)

CDK requires a one-time bootstrap stack (`CDKToolkit`) in the AWS account and region where you will deploy (creates the staging S3 bucket, ECR asset repo, and CDK execution roles).

Run from your local machine (authenticated with AWS CLI):

```bash
cd multi-container-services-prod/infra
npm ci
npx cdk bootstrap aws://<ACCOUNT_ID>/<TARGET_REGION>
```

Example for `ap-south-1`:
```bash
npx cdk bootstrap aws://123456789012/ap-south-1
```

*(You can verify your account ID with `aws sts get-caller-identity`.)*

---

## 3. Configure GitHub OIDC & IAM Deploy Role in AWS

The GitHub Actions workflow uses **OIDC** (short-lived temporary tokens, no static AWS access keys).

### 3.1 Add GitHub as an IAM OIDC Identity Provider (Skip if Already Exists)

1. Open **IAM → Identity providers → Add provider**.
2. **Provider type:** `OpenID Connect`
3. **Provider URL:** `https://token.actions.githubusercontent.com`
4. **Audience:** `sts.amazonaws.com`
5. Click **Add provider**.

### 3.2 Create the IAM Role for GitHub Actions

1. Open **IAM → Roles → Create role → Custom trust policy**.
2. Paste this trust policy (replace `<ACCOUNT_ID>` and `<GITHUB_ORG>/<REPO_NAME>`):

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

3. Click **Next**, skip managed policies for now, name the role (e.g., `github-deploy-multi-container-services-prod`), and create it.
4. Open the newly created role → **Permissions → Add permissions → Create inline policy** (JSON) and attach the following minimal CDK deploy policy (replace `<ACCOUNT_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-*"
    },
    {
      "Sid": "ReadCdkBootstrapVersion",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:*:<ACCOUNT_ID>:parameter/cdk-bootstrap/*"
    }
  ]
}
```

5. Copy the role's **ARN**:
   ```text
   arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-multi-container-services-prod
   ```

---

## 4. Add GitHub Repository Variables

In your GitHub repository, go to **Settings → Secrets and variables → Actions → Variables** and add:

| Variable Name | Required | Example Value |
| :--- | :--- | :--- |
| `AWS_REGION` | Yes | `ap-south-1` (or `us-east-1`) |
| `AWS_OIDC_ROLE_ARN` | Yes | `arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-multi-container-services-prod` |
| `ACM_CERTIFICATE_ARN` | Yes | `arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<CERT_UUID>` |
| `ROUTE53_HOSTED_ZONE_ID` | Optional | `Z0123456789ABCDEFGHIJ` *(set only if `techtoday.click` is hosted in Route 53)* |

---

## 5. DNS Record for `fib2.techtoday.click`

- **If `techtoday.click` is in Route 53** and you set `ROUTE53_HOSTED_ZONE_ID` above:
  - Nothing to do manually — CDK automatically creates both `A` and `AAAA` Alias records pointing `fib2.techtoday.click` to CloudFront.
- **If `techtoday.click` is in an external DNS provider** (Cloudflare, Namecheap, GoDaddy, etc.):
  - Leave `ROUTE53_HOSTED_ZONE_ID` unset.
  - After the first GitHub Actions deploy completes, copy **`CloudFrontDomainName`** from the workflow logs (or CloudFormation stack outputs) and add:

| Hostname | Record Type | Target / Value | Notes |
| :--- | :--- | :--- | :--- |
| `fib2.techtoday.click` | **CNAME** | `<CloudFrontDomainName>` (e.g. `d1234abcd.cloudfront.net`) | If using Cloudflare DNS, set proxy to **DNS only (gray cloud)** |

---

## Pre-Push Checklist

- [ ] ACM certificate for `fib2.techtoday.click` created in **`us-east-1`** and status is **Issued**
- [ ] `npx cdk bootstrap` completed for your target AWS account and region
- [ ] GitHub OIDC provider exists in AWS IAM
- [ ] IAM deploy role created with trust policy scoped to your repo's `main` branch and inline CDK assume-role policy
- [ ] GitHub Repository Variables added: `AWS_REGION`, `AWS_OIDC_ROLE_ARN`, `ACM_CERTIFICATE_ARN` (and `ROUTE53_HOSTED_ZONE_ID` if using Route 53)
- [ ] Ready to push to `main` (first deploy takes ~10–15 minutes)

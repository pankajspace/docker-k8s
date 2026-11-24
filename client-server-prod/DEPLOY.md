# Deploying `client-server-prod` with AWS CDK

Complete prerequisites in **[AWS.md](./AWS.md)** first (ACM certificate in `us-east-1`, EC2 key pair, CDK bootstrap).

---

## 1. Build the React Frontend

```bash
cd client-server-prod/client
npm ci
VITE_API_URL=https://api.fib1.techtoday.click npm run build
```

---

## 2. Deploy Infrastructure & Frontend with CDK

```bash
cd ../infra
npm ci

export FIB1_ACM_CERTIFICATE_ARN="arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<UUID>"
export ACM_CERTIFICATE_ARN="$FIB1_ACM_CERTIFICATE_ARN"
export EC2_KEY_PAIR_NAME="fib1-ec2-key"
# Optional — only if techtoday.click is in Route 53:
# export ROUTE53_HOSTED_ZONE_ID="ZXXXXXXXXXXXXX"

npm run typecheck
npm run synth
npm run diff
npm run deploy
```

CDK outputs `FrontendUrl`, `CloudFrontDomainName`, and `Ec2PublicIp`.

---

## 3. Deploy the Backend Containers to EC2

Wait ~60–90 seconds after initial EC2 launch for the User Data script to finish installing Docker & Compose, then sync and start the containers:

```bash
export EC2_IP="<Ec2PublicIp from CDK output>"
export SSH_KEY="/path/to/fib1-ec2-key.pem"

rsync -avz --delete --exclude 'node_modules' -e "ssh -i $SSH_KEY" \
  ../server/ "ec2-user@${EC2_IP}:~/client-server-prod/server/"
rsync -avz --delete --exclude '.env' -e "ssh -i $SSH_KEY" \
  ../ec2/ "ec2-user@${EC2_IP}:~/client-server-prod/ec2/"

ssh -i "$SSH_KEY" "ec2-user@${EC2_IP}" \
  "cd ~/client-server-prod/ec2 && docker compose -f docker-compose.prod.yml up -d --build"
```

---

## 4. Verify

```bash
curl -i https://api.fib1.techtoday.click/
```

Open **`https://fib1.techtoday.click`** in your browser and test submitting an index.

---

## 5. Teardown

To delete all AWS resources created by the stack (S3, CloudFront, EC2, Elastic IP, VPC):

```bash
cd client-server-prod/infra
npm run destroy
```

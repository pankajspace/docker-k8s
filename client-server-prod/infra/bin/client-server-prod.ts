#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ClientServerProdStack } from "../lib/client-server-prod-stack";

const app = new cdk.App();

const frontendDomain =
  (app.node.tryGetContext("frontendDomain") as string | undefined) ||
  process.env.FRONTEND_DOMAIN ||
  "fib1.techtoday.click";

const apiDomain =
  (app.node.tryGetContext("apiDomain") as string | undefined) ||
  process.env.API_DOMAIN ||
  "api.fib1.techtoday.click";

const acmCertificateArn =
  (app.node.tryGetContext("acmCertificateArn") as string | undefined) ||
  process.env.ACM_CERTIFICATE_ARN;

const ec2KeyPairName =
  (app.node.tryGetContext("ec2KeyPairName") as string | undefined) ||
  process.env.EC2_KEY_PAIR_NAME;

const sshCidr =
  (app.node.tryGetContext("sshCidr") as string | undefined) ||
  process.env.SSH_CIDR ||
  "0.0.0.0/0";

const hostedZoneId =
  (app.node.tryGetContext("hostedZoneId") as string | undefined) ||
  process.env.ROUTE53_HOSTED_ZONE_ID;

const hostedZoneName =
  (app.node.tryGetContext("hostedZoneName") as string | undefined) ||
  process.env.ROUTE53_HOSTED_ZONE_NAME ||
  "techtoday.click";

new ClientServerProdStack(app, "ClientServerProdStack", {
  description:
    "Client-Server Fibonacci app on AWS: S3 + CloudFront (fib1.techtoday.click) and EC2 + Caddy (api.fib1.techtoday.click).",
  frontendDomain,
  apiDomain,
  acmCertificateArn,
  ec2KeyPairName,
  sshCidr,
  hostedZoneId,
  hostedZoneName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

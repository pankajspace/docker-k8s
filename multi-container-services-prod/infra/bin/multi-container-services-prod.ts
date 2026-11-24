#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MultiContainerServicesProdStack } from "../lib/multi-container-services-prod-stack";

const app = new cdk.App();

const domainName =
  (app.node.tryGetContext("domainName") as string | undefined) ||
  process.env.DOMAIN_NAME ||
  "fib2.techtoday.click";

const acmCertificateArn =
  (app.node.tryGetContext("acmCertificateArn") as string | undefined) ||
  process.env.ACM_CERTIFICATE_ARN;

const hostedZoneId =
  (app.node.tryGetContext("hostedZoneId") as string | undefined) ||
  process.env.ROUTE53_HOSTED_ZONE_ID;

const hostedZoneName =
  (app.node.tryGetContext("hostedZoneName") as string | undefined) ||
  process.env.ROUTE53_HOSTED_ZONE_NAME ||
  "techtoday.click";

new MultiContainerServicesProdStack(app, "MultiContainerServicesProdStack", {
  description:
    "Multi-container Fibonacci app on AWS (fib2.techtoday.click): CloudFront + S3, ALB, ECS Fargate (API + Worker), RDS PostgreSQL, and ElastiCache Valkey Serverless.",
  domainName,
  acmCertificateArn,
  hostedZoneId,
  hostedZoneName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

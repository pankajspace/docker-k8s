#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MultiContainerServicesProdStack } from "../lib/multi-container-services-prod-stack";

const app = new cdk.App();

new MultiContainerServicesProdStack(app, "MultiContainerServicesProdStack", {
  description:
    "Multi-container Fibonacci app on AWS: CloudFront + S3, ALB, ECS Fargate (API + Worker), RDS PostgreSQL, and ElastiCache Valkey Serverless.",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

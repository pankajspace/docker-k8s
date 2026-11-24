import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

export interface MultiContainerServicesProdStackProps extends cdk.StackProps {
  /** Custom domain served by CloudFront (default: fib2.techtoday.click). */
  readonly domainName: string;
  /**
   * ARN of an issued ACM certificate in us-east-1 covering `domainName`.
   * Required to attach the custom domain to CloudFront.
   */
  readonly acmCertificateArn?: string;
  /**
   * Optional Route 53 Hosted Zone ID for `hostedZoneName`.
   * When provided alongside `acmCertificateArn`, CDK creates A/AAAA Alias records automatically.
   */
  readonly hostedZoneId?: string;
  /** Parent DNS zone name (default: techtoday.click). */
  readonly hostedZoneName?: string;
}

export class MultiContainerServicesProdStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: MultiContainerServicesProdStackProps
  ) {
    super(scope, id, props);

    const { domainName, acmCertificateArn, hostedZoneId, hostedZoneName } =
      props;

    // =========================================================================
    // 1. Networking (VPC: Public Subnets for ALB, Private Subnets for Compute/Data)
    // =========================================================================
    // Uses 1 NAT Gateway by default to save ~$32/mo; increase to 2 for Multi-AZ HA.
    const vpc = new ec2.Vpc(this, "AppVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "PrivateApp",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "PrivateData",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Security groups with least-privilege rules between tiers
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "Allow HTTP traffic from CloudFront to ALB",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from CloudFront (enforced via X-Origin-Verify header)"
    );

    const apiSg = new ec2.SecurityGroup(this, "ApiSg", {
      vpc,
      description: "ECS Fargate API service security group",
      allowAllOutbound: true,
    });
    apiSg.addIngressRule(
      albSg,
      ec2.Port.tcp(5000),
      "Allow ALB to reach Express API on port 5000"
    );

    const workerSg = new ec2.SecurityGroup(this, "WorkerSg", {
      vpc,
      description: "ECS Fargate Worker service security group (outbound only)",
      allowAllOutbound: true,
    });

    const rdsSg = new ec2.SecurityGroup(this, "RdsSg", {
      vpc,
      description: "Allow PostgreSQL access only from API Fargate tasks",
      allowAllOutbound: false,
    });
    rdsSg.addIngressRule(
      apiSg,
      ec2.Port.tcp(5432),
      "Allow API service to connect to RDS PostgreSQL"
    );

    const valkeySg = new ec2.SecurityGroup(this, "ValkeySg", {
      vpc,
      description: "Allow Valkey/Redis access only from API and Worker tasks",
      allowAllOutbound: false,
    });
    valkeySg.addIngressRule(
      apiSg,
      ec2.Port.tcp(6379),
      "Allow API service to connect to ElastiCache Valkey"
    );
    valkeySg.addIngressRule(
      workerSg,
      ec2.Port.tcp(6379),
      "Allow Worker service to connect to ElastiCache Valkey"
    );

    // =========================================================================
    // 2. Managed Data Services (RDS for PostgreSQL + ElastiCache Valkey Serverless)
    // =========================================================================
    const databaseName = "fibdb";

    // Note: For strict production, set multiAz: true, deletionProtection: true,
    // and removalPolicy: cdk.RemovalPolicy.SNAPSHOT.
    const postgres = new rds.DatabaseInstance(this, "PostgresDb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSg],
      databaseName,
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      allocatedStorage: 20,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const valkeyCache = new elasticache.CfnServerlessCache(
      this,
      "ValkeyServerlessCache",
      {
        engine: "valkey",
        serverlessCacheName: "fib-valkey-serverless",
        description: "Valkey Serverless cache and Pub/Sub broker for Fibonacci app",
        subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
        securityGroupIds: [valkeySg.securityGroupId],
        cacheUsageLimits: {
          dataStorage: {
            maximum: 1,
            unit: "GB",
          },
          ecpuPerSecond: {
            maximum: 1000,
          },
        },
      }
    );

    // =========================================================================
    // 3. ECS Cluster & Fargate Services (API + Background Worker)
    // =========================================================================
    const cluster = new ecs.Cluster(this, "AppCluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    // --- API Task Definition & Service ---
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiTaskDef = new ecs.FargateTaskDefinition(this, "ApiTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const apiContainer = apiTaskDef.addContainer("api", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../server"),
        { platform: ecrAssets.Platform.LINUX_AMD64 }
      ),
      stopTimeout: cdk.Duration.seconds(30),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: apiLogGroup,
        streamPrefix: "api",
      }),
      environment: {
        PORT: "5000",
        CLIENT_ORIGIN: `https://${domainName}`,
        PGHOST: postgres.dbInstanceEndpointAddress,
        PGPORT: postgres.dbInstanceEndpointPort,
        PGDATABASE: databaseName,
        PGSSL: "true",
        REDIS_HOST: valkeyCache.attrEndpointAddress,
        REDIS_PORT: valkeyCache.attrEndpointPort,
        REDIS_TLS: "true",
      },
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(postgres.secret!, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(postgres.secret!, "password"),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(15),
      },
    });
    apiContainer.addPortMappings({
      containerPort: 5000,
      protocol: ecs.Protocol.TCP,
    });

    const apiService = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition: apiTaskDef,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    // --- Worker Task Definition & Service ---
    const workerLogGroup = new logs.LogGroup(this, "WorkerLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const workerTaskDef = new ecs.FargateTaskDefinition(this, "WorkerTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    workerTaskDef.addContainer("worker", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../worker"),
        { platform: ecrAssets.Platform.LINUX_AMD64 }
      ),
      stopTimeout: cdk.Duration.seconds(30),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: workerLogGroup,
        streamPrefix: "worker",
      }),
      environment: {
        REDIS_HOST: valkeyCache.attrEndpointAddress,
        REDIS_PORT: valkeyCache.attrEndpointPort,
        REDIS_TLS: "true",
      },
    });

    const workerService = new ecs.FargateService(this, "WorkerService", {
      cluster,
      taskDefinition: workerTaskDef,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [workerSg],
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
    });

    // =========================================================================
    // 4. Application Load Balancer (Origin for CloudFront /api/* requests)
    // =========================================================================
    // Shared header verified by ALB so direct public access bypassing CloudFront is rejected.
    const originVerifyHeaderValue = `fib-origin-${this.account}-${this.region}`;

    const alb = new elbv2.ApplicationLoadBalancer(this, "ApiAlb", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSg,
    });

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "ApiTargetGroup",
      {
        vpc,
        port: 5000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: cdk.Duration.seconds(30),
        healthCheck: {
          path: "/health",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      }
    );
    apiService.attachToApplicationTargetGroup(apiTargetGroup);

    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: "text/plain",
        messageBody: "Access denied. Use the CloudFront URL.",
      }),
    });

    httpListener.addAction("AllowCloudFrontOrigin", {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.httpHeader("X-Origin-Verify", [
          originVerifyHeaderValue,
        ]),
      ],
      action: elbv2.ListenerAction.forward([apiTargetGroup]),
    });

    // =========================================================================
    // 5. Frontend Static Hosting (Private S3 Bucket + Single-Origin CloudFront)
    // =========================================================================
    const siteBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const certificate = acmCertificateArn
      ? acm.Certificate.fromCertificateArn(
          this,
          "SiteCertificate",
          acmCertificateArn
        )
      : undefined;

    const distribution = new cloudfront.Distribution(this, "AppDistribution", {
      comment: `Single-origin CloudFront for ${domainName}`,
      defaultRootObject: "index.html",
      ...(certificate
        ? {
            domainNames: [domainName],
            certificate,
          }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.LoadBalancerV2Origin(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            customHeaders: {
              "X-Origin-Verify": originVerifyHeaderValue,
            },
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      // SPA fallback so React Router paths (e.g. /otherpage) resolve to index.html
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Optional: automatically create Route 53 A/AAAA Alias records if hostedZoneId is provided
    if (certificate && hostedZoneId && hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId,
          zoneName: hostedZoneName,
        }
      );

      const recordName = domainName.endsWith(`.${hostedZoneName}`)
        ? domainName.slice(0, -(hostedZoneName.length + 1))
        : domainName;

      new route53.ARecord(this, "SiteAliasRecordA", {
        zone,
        recordName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution)
        ),
      });

      new route53.AaaaRecord(this, "SiteAliasRecordAAAA", {
        zone,
        recordName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution)
        ),
      });
    }

    // Deploy compiled React static bundle (run `npm run build` in ../client first)
    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "../../client/dist")),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // =========================================================================
    // 6. Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "AppUrl", {
      value: certificate
        ? `https://${domainName}`
        : `https://${distribution.distributionDomainName}`,
      description: "Single-origin HTTPS URL for the application",
    });

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName,
      description: `DNS CNAME / Route 53 Alias target for ${domainName}`,
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: siteBucket.bucketName,
    });

    new cdk.CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
    });

    new cdk.CfnOutput(this, "ApiServiceName", {
      value: apiService.serviceName,
    });

    new cdk.CfnOutput(this, "WorkerServiceName", {
      value: workerService.serviceName,
    });
  }
}

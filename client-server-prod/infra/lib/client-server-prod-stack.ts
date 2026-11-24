import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

export interface ClientServerProdStackProps extends cdk.StackProps {
  /** Frontend custom domain served by CloudFront (default: fib1.techtoday.click). */
  readonly frontendDomain: string;
  /** Backend API custom domain served by Caddy on EC2 (default: api.fib1.techtoday.click). */
  readonly apiDomain: string;
  /** ARN of an issued ACM certificate in us-east-1 covering `frontendDomain`. */
  readonly acmCertificateArn?: string;
  /** Existing EC2 key pair name for SSH / GitHub Actions rsync deploys. */
  readonly ec2KeyPairName?: string;
  /** CIDR allowed for SSH port 22 (defaults to 0.0.0.0/0 for GitHub-hosted runners; restrict to <IP>/32 if not using GitHub SSH). */
  readonly sshCidr?: string;
  /** Optional Route 53 Hosted Zone ID for `hostedZoneName`. */
  readonly hostedZoneId?: string;
  /** Parent DNS zone name (default: techtoday.click). */
  readonly hostedZoneName?: string;
}

export class ClientServerProdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClientServerProdStackProps) {
    super(scope, id, props);

    const {
      frontendDomain,
      apiDomain,
      acmCertificateArn,
      ec2KeyPairName,
      sshCidr = "0.0.0.0/0",
      hostedZoneId,
      hostedZoneName,
    } = props;

    // =========================================================================
    // 1. Networking (Public-Only VPC — 0 NAT Gateways to keep cost minimal)
    // =========================================================================
    const vpc = new ec2.Vpc(this, "AppVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // =========================================================================
    // 2. Backend Compute (EC2 + Elastic IP + Docker/Compose Bootstrap)
    // =========================================================================
    const ec2Sg = new ec2.SecurityGroup(this, "ApiEc2Sg", {
      vpc,
      description: "Allow HTTP/HTTPS (Caddy) and SSH for client-server-prod EC2",
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Caddy ACME HTTP-01 challenge and HTTPS redirect"
    );
    ec2Sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS API traffic (Caddy)"
    );
    ec2Sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(443),
      "HTTP/3 (QUIC) traffic (Caddy)"
    );
    ec2Sg.addIngressRule(
      ec2.Peer.ipv4(sshCidr),
      ec2.Port.tcp(22),
      "SSH for admin and GitHub Actions rsync deploy"
    );

    const ec2Role = new iam.Role(this, "ApiEc2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      "dnf update -y",
      "dnf install -y docker rsync",
      "systemctl enable --now docker",
      "usermod -aG docker ec2-user",
      // Install Docker Compose v2 CLI plugin (ARM64)
      "mkdir -p /usr/local/lib/docker/cli-plugins",
      "curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose",
      "chmod +x /usr/local/lib/docker/cli-plugins/docker-compose",
      // Pre-create runtime directories and ec2/.env for Caddy + Express
      "mkdir -p /home/ec2-user/client-server-prod/server /home/ec2-user/client-server-prod/ec2",
      `cat <<'EOF' > /home/ec2-user/client-server-prod/ec2/.env
API_DOMAIN=${apiDomain}
CLIENT_ORIGIN=https://${frontendDomain}
EOF`,
      "chown -R ec2-user:ec2-user /home/ec2-user/client-server-prod"
    );

    const instance = new ec2.Instance(this, "ApiInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: ec2Sg,
      role: ec2Role,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      requireImdsv2: true,
      userData,
      ...(ec2KeyPairName
        ? {
            keyPair: ec2.KeyPair.fromKeyPairName(
              this,
              "ApiKeyPair",
              ec2KeyPairName
            ),
          }
        : {}),
    });

    const eip = new ec2.CfnEIP(this, "ApiElasticIp", {
      domain: "vpc",
      instanceId: instance.instanceId,
    });

    // =========================================================================
    // 3. Frontend Hosting (Private S3 Bucket + CloudFront with OAC)
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
          "FrontendCertificate",
          acmCertificateArn
        )
      : undefined;

    const distribution = new cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        comment: `React SPA CloudFront for ${frontendDomain}`,
        defaultRootObject: "index.html",
        ...(certificate
          ? {
              domainNames: [frontendDomain],
              certificate,
            }
          : {}),
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
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
      }
    );

    // Upload compiled React static bundle (built with VITE_API_URL=https://api.fib1.techtoday.click)
    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "../../client/dist")),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // =========================================================================
    // 4. Optional Route 53 DNS Records
    // =========================================================================
    if (hostedZoneId && hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId,
          zoneName: hostedZoneName,
        }
      );

      const toRelativeName = (fqdn: string) =>
        fqdn.endsWith(`.${hostedZoneName}`)
          ? fqdn.slice(0, -(hostedZoneName.length + 1))
          : fqdn;

      if (certificate) {
        const frontendRecordName = toRelativeName(frontendDomain);
        new route53.ARecord(this, "FrontendAliasA", {
          zone,
          recordName: frontendRecordName,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.CloudFrontTarget(distribution)
          ),
        });
        new route53.AaaaRecord(this, "FrontendAliasAAAA", {
          zone,
          recordName: frontendRecordName,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.CloudFrontTarget(distribution)
          ),
        });
      }

      new route53.ARecord(this, "ApiRecordA", {
        zone,
        recordName: toRelativeName(apiDomain),
        target: route53.RecordTarget.fromIpAddresses(eip.ref),
      });
    }

    // =========================================================================
    // 5. Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "FrontendUrl", {
      value: certificate
        ? `https://${frontendDomain}`
        : `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `https://${apiDomain}`,
    });

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName,
      description: `DNS CNAME / Route 53 Alias target for ${frontendDomain}`,
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: siteBucket.bucketName,
    });

    new cdk.CfnOutput(this, "Ec2PublicIp", {
      value: eip.ref,
      description: `Elastic IP (DNS A record target for ${apiDomain} and EC2_HOST for SSH)`,
    });

    new cdk.CfnOutput(this, "Ec2InstanceId", {
      value: instance.instanceId,
    });
  }
}

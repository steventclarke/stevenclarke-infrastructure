# Onboarding an Application

This guide walks through onboarding a new application onto the `stevenclarke.dev`
platform. It covers both the platform-side registration step and the application-side
setup, with worked examples in AWS CDK (TypeScript) and Terraform.

## Overview

The platform repository (`stevenclarke-infrastructure`) owns the shared AWS foundation:

- The `stevenclarke.dev` Route 53 hosted zone.
- A wildcard TLS certificate for `*.stevenclarke.dev` (CloudFront, in `us-east-1`).
- A shared VPC (in `us-east-2`).
- GitHub Actions OIDC trust and per-application IAM deploy roles.
- Monitoring and budget alerts.

Each application repository owns its own compute, storage, queues, secrets, and other
app-specific resources, and deploys them independently. Applications create their own
DNS records in the shared hosted zone using a scoped IAM role.

The platform publishes shared values as SSM Parameters (the "cross-tool contract") so
that both CDK and Terraform consumers can read them without depending on CloudFormation
exports.

## What the platform provides vs. what you own

| Concern | Owner |
| --- | --- |
| `stevenclarke.dev` hosted zone | Platform |
| Wildcard certificate `*.stevenclarke.dev` | Platform |
| Shared VPC | Platform |
| GitHub OIDC provider | Platform |
| Per-app deploy roles (`<app>-deploy-preview`, `<app>-deploy-prod`) | Platform |
| DNS records for your hostnames | **Application** |
| S3 buckets, CloudFront distributions, ECS, queues, secrets | **Application** |
| App-specific certificates (regional endpoints only) | **Application** |

## Prerequisites

Before onboarding, confirm the following are already in place (they are created by the
platform's `OidcStack`, `DnsStack`, `CertificateStack`, and `NetworkStack`):

- The application is registered in `config/applications.ts` (see Step 1).
- The platform stacks have been deployed, publishing the SSM parameters below.
- The application's deploy roles exist and their trust policies match the app's GitHub
  OIDC subject (see the OIDC note in Troubleshooting).

## Step 1: Register the application in the platform

Add an entry to [`config/applications.ts`](../config/applications.ts) in the platform
repository. This drives the per-app deploy roles and their SSM role-ARN parameters.

```ts
{
  name: 'my-app',
  repo: 'steventclarke/my-app',
  subdomains: {
    preview: ['my-app-preview.stevenclarke.dev'],
    prod: ['my-app.stevenclarke.dev'],
  },
  // hasApi: true, // set if the app has an API component
}
```

Deploy the platform stacks (`npm run deploy` in the platform repo). This creates:

- `my-app-deploy-preview` (trusted by `repo:steventclarke/my-app:ref:refs/heads/preview`)
- `my-app-deploy-prod` (trusted by `repo:steventclarke/my-app:ref:refs/heads/main`)
- SSM parameters `/platform/roles/my-app/preview/deploy-role-arn` and
  `/platform/roles/my-app/prod/deploy-role-arn`

> **OIDC subject note:** GitHub now includes a generated numeric ID in the OIDC `sub`
> claim (e.g. `repo:steventclarke@3586962/my-app@123456789:ref:refs/heads/main`). The
> platform's `OidcStack` must use the exact subject for your repository. See
> [Troubleshooting](#troubleshooting) for how to obtain it.

## Step 2: Read shared values from SSM

The platform publishes these parameters (all in `us-east-2` unless noted):

| Parameter | Purpose |
| --- | --- |
| `/platform/dns/hosted-zone-id` | Shared Route 53 zone ID |
| `/platform/dns/domain-name` | `stevenclarke.dev` |
| `/platform/certs/us-east-1/wildcard-arn` | Wildcard CloudFront certificate ARN (mirrored into `us-east-2`) |
| `/platform/network/vpc-id` | Shared VPC ID |
| `/platform/network/subnet-ids` | Comma-separated subnet IDs available to applications |
| `/platform/roles/<app>/preview/deploy-role-arn` | Your app's preview deploy role ARN |
| `/platform/roles/<app>/prod/deploy-role-arn` | Your app's prod deploy role ARN |

> `/platform/monitoring/alerts-topic-arn` and `/platform/region` are planned but not yet
> published. Read the region from your own configuration for now.

## Step 3: Set up your IaC project

### CDK (TypeScript)

Initialize a CDK app in your repository:

```bash
mkdir my-app-infra && cd my-app-infra
npx cdk init app --language typescript
npm install
```

### Terraform

Initialize a Terraform project:

```bash
mkdir my-app-infra && cd my-app-infra
terraform init
```

## Step 4: Configure GitHub Actions OIDC

Your deploy role is assumed via GitHub OIDC. In your workflow, use
`aws-actions/configure-aws-credentials@v4` with the role ARN read from SSM (or stored as
a repository variable/secret).

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.DEPLOY_ROLE_ARN }}
          aws-region: us-east-2
```

Set `DEPLOY_ROLE_ARN` to the value of `/platform/roles/my-app/prod/deploy-role-arn`
(for `main`) and a preview equivalent for the `preview` branch.

## Step 5: Create DNS records

Your app creates its own records in the shared hosted zone. The deploy role already has
`route53:ChangeResourceRecordSets` scoped to the `stevenclarke.dev` zone.

## Step 6: Use the shared certificate

For CloudFront, reference the wildcard certificate ARN from
`/platform/certs/us-east-1/wildcard-arn`. It covers `*.stevenclarke.dev` and the apex, so
your `<app>.stevenclarke.dev` and `<app>-preview.stevenclarke.dev` hostnames are already
covered. Regional endpoints (ALB/API Gateway) may need a regional certificate in
`us-east-2`; see [regional-certificate-pattern.md](./regional-certificate-pattern.md).

## Step 7: CI/CD flows

- Merge to `preview`: auto-deploy the preview tenant using the preview role.
- Merge to `main`: deploy production after manual approval through the `production`
  GitHub Environment.

## Full CDK example (static S3 + CloudFront site)

This is the pattern used by the portfolio pilot. It reads shared values from SSM and
creates a private S3 bucket, a CloudFront distribution, and a Route 53 record.

```ts
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class MyAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') ?? 'preview';
    const domainName = ssm.StringParameter.valueFromLookup(
      this, '/platform/dns/domain-name'
    );
    const hostedZoneId = ssm.StringParameter.valueFromLookup(
      this, '/platform/dns/hosted-zone-id'
    );
    const certArn = ssm.StringParameter.valueFromLookup(
      this, '/platform/certs/us-east-1/wildcard-arn'
    );

    const hostname = environment === 'prod'
      ? 'my-app.stevenclarke.dev'
      : 'my-app-preview.stevenclarke.dev';

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [hostname],
      certificate: cloudfront.Certificate.fromCertificateArn(this, 'Cert', certArn),
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId,
      zoneName: domainName,
    });

    new route53.ARecord(this, 'AliasRecord', {
      zone,
      recordName: hostname,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });
  }
}
```

Tag all resources with `environment`, `project`, `owner`, `application`, and
`managed-by` (see [Naming and tagging](#naming-and-tagging-conventions)).

## Full Terraform example (static S3 + CloudFront site)

The equivalent static site in Terraform, reading the same SSM parameters.

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type    = string
  default = "preview"
}

data "aws_ssm_parameter" "domain_name" {
  name = "/platform/dns/domain-name"
}

data "aws_ssm_parameter" "hosted_zone_id" {
  name = "/platform/dns/hosted-zone-id"
}

data "aws_ssm_parameter" "wildcard_cert_arn" {
  name = "/platform/certs/us-east-1/wildcard-arn"
}

locals {
  hostname = var.environment == "prod" ? "my-app.stevenclarke.dev" : "my-app-preview.stevenclarke.dev"
}

resource "aws_s3_bucket" "site" {
  bucket = "${local.hostname}-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_distribution" "site" {
  enabled = true

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "s3"
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
  }

  aliases = [local.hostname]

  viewer_certificate {
    acm_certificate_arn = data.aws_ssm_parameter.wildcard_cert_arn.value
    ssl_support_method  = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

resource "aws_route53_record" "site" {
  zone_id = data.aws_ssm_parameter.hosted_zone_id.value
  name    = local.hostname
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
```

## Naming and tagging conventions

- Environment names: `preview` and `prod`.
- Stack/resource naming: `<app>-preview` and `<app>-prod`.
- Hostnames:
  - Web app: `<app>.stevenclarke.dev` (prod), `<app>-preview.stevenclarke.dev` (preview).
  - API component: `<app>-api.stevenclarke.dev` (prod), `<app>-api-preview.stevenclarke.dev` (preview).
- Tags on every resource: `project`, `environment` (`preview`/`prod`), `owner`,
  `application`, `managed-by`.

## Troubleshooting

### OIDC "Not authorized to perform sts:AssumeRoleWithWebIdentity"

GitHub now includes a generated numeric ID in the OIDC `sub` claim. The exact subject is
visible in the failed workflow's CloudTrail event, or you can obtain it from the
workflow's OIDC token. The platform's `OidcStack` trust policy must use the exact
subject, e.g.:

```
repo:steventclarke@3586962/my-app@123456789:ref:refs/heads/main
```

If the trust policy uses the older `repo:steventclarke/my-app:ref:refs/heads/main`
format, the assumption fails. Update the platform's `OidcStack` with the generated ID and
redeploy.

### Certificate not covering my hostname

The wildcard `*.stevenclarke.dev` covers exactly one label below the apex. Use the
`<app>.stevenclarke.dev` / `<app>-preview.stevenclarke.dev` / `<app>-api.stevenclarke.dev`
convention. Deeper nesting (e.g. `*.squat-monster.stevenclarke.dev`) is not covered; see
[regional-certificate-pattern.md](./regional-certificate-pattern.md).

### SSM parameter not found

SSM is regional. The certificate ARN is mirrored into `us-east-2`; read it from
`us-east-2`. If a parameter is missing, confirm the platform stacks were deployed after
your app was registered in `config/applications.ts`.

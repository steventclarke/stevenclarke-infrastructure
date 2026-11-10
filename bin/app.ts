#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { envs } from '../config/environments';
import { DnsStack } from '../lib/dns-stack';
import { CertificateStack } from '../lib/certificate-stack';
import { OidcStack } from '../lib/oidc-stack';
import { NetworkStack } from '../lib/network-stack';
import { ApexRecordStack } from '../lib/apex-record-stack';

const app = new cdk.App();

// The platform is a single global deployment target for the account; there is no
// preview/prod split for this repository. Tenant applications manage their own
// preview/prod environments independently.
Tags.of(app).add('Project', 'stevenclarke-infrastructure');
Tags.of(app).add('Owner', 'stevenclarke');
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Application', 'platform');

new DeveloperRoleStack(app, 'DeveloperRoleStack', {
  env: envs.primary,
  description: 'Read-only developer role for troubleshooting',
});

new MonitoringStack(app, 'MonitoringStack', {
  env: envs.primary,
  description: 'Budget and monitoring alerts',
});

const dnsStack = new DnsStack(app, 'DnsStack', {
  env: envs.primary,
  crossRegionReferences: true,
  description: 'Route 53 hosted zone for stevenclarke.dev',
});

// Certificates must be in us-east-1 for CloudFront
const certStack = new CertificateStack(app, 'CertificateStack', {
  env: envs.usEast1,
  crossRegionReferences: true,
  hostedZone: dnsStack.hostedZone,
  description: 'ACM certificates for CloudFront (us-east-1)',
});

// Mirror cert ARNs to us-east-2 SSM for application consumption
const certParamsStack = new cdk.Stack(app, 'CertificateParametersStack', {
  env: envs.primary,
  crossRegionReferences: true,
  description: 'Mirror certificate ARNs to us-east-2 SSM',
});
certParamsStack.addDependency(certStack);

new ssm.StringParameter(certParamsStack, 'WildcardCertArnParamUsEast2', {
  parameterName: '/platform/certs/us-east-1/wildcard-arn',
  stringValue: certStack.wildcardCert.certificateArn,
  description: 'Wildcard certificate ARN for *.stevenclarke.dev (mirrored to us-east-2)',
});

new OidcStack(app, 'OidcStack', {
  env: { account: envs.primary.account, region: envs.primary.region },
});

new NetworkStack(app, 'NetworkStack', {
  env: { account: envs.primary.account, region: envs.primary.region },
});

new ApexRecordStack(app, 'ApexRecordStack', {
  env: envs.primary,
  description: 'Apex record for stevenclarke.dev pointing to the portfolio distribution',
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

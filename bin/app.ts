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
import { AnalyticsStack } from '../lib/analytics-stack';
import { AuthStack } from '../lib/auth-stack';
import { ArtifactsStack } from '../lib/artifacts-stack';

const app = new cdk.App();

// The platform is a single global deployment target for the account; there is no
// preview/prod split for this repository. Tenant applications manage their own
// preview/prod environments independently.
Tags.of(app).add('Project', 'stevenclarke-infrastructure');
Tags.of(app).add('Owner', 'stevenclarke');
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Application', 'platform');

const artifactsStack = new ArtifactsStack(app, 'ArtifactsStack', {
  env: envs.primary,
  description: 'Shared CodeArtifact domain and repositories for internal packages',
});

const developerRoleStack = new DeveloperRoleStack(app, 'DeveloperRoleStack', {
  env: envs.primary,
  description: 'Read-only developer role for troubleshooting',
  artifacts: artifactsStack.artifacts,
});
developerRoleStack.addDependency(artifactsStack);

const monitoringStack = new MonitoringStack(app, 'MonitoringStack', {
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

const authStack = new AuthStack(app, 'AuthStack', {
  env: envs.primary,
  description: 'Shared Cognito user pool with Google IdP for tenant apps',
});

const oidcStack = new OidcStack(app, 'OidcStack', {
  env: envs.primary,
  userPoolArn: authStack.userPool.userPoolArn,
  artifacts: artifactsStack.artifacts,
});
oidcStack.addDependency(artifactsStack);

const networkStack = new NetworkStack(app, 'NetworkStack', {
  env: { account: envs.primary.account, region: envs.primary.region },
});

const apexStack = new ApexRecordStack(app, 'ApexRecordStack', {
  env: envs.primary,
  description: 'Apex record for stevenclarke.dev pointing to the portfolio distribution',
});
// The apex stack reads the zone ID and domain name from SSM, which DnsStack owns.
apexStack.addDependency(dnsStack);

const analyticsStack = new AnalyticsStack(app, 'AnalyticsStack', {
  env: envs.primary,
  description: 'Self-hosted GoatCounter analytics (EC2 + CloudFront)',
});
// Analytics reads the VPC, DNS zone, certificate, and alert topic from SSM, so
// it must deploy after those stacks publish their parameters.
analyticsStack.addDependency(dnsStack);
analyticsStack.addDependency(certParamsStack);
analyticsStack.addDependency(networkStack);
analyticsStack.addDependency(monitoringStack);

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

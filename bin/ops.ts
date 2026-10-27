#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { envs } from '../config/environments';
import { DnsStack } from '../lib/dns-stack';
import { CertificateStack } from '../lib/certificate-stack';

const app = new cdk.App();

Tags.of(app).add('Project', 'stevenclarke-infrastructure');
Tags.of(app).add('Owner', 'stevenclarke');
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Application', 'platform');

new DeveloperRoleStack(app, 'DeveloperRoleStack', {
  env: envs.prod,
  description: 'Read-only developer role for troubleshooting',
});

new MonitoringStack(app, 'MonitoringStack', {
  env: envs.prod,
  description: 'Budget and monitoring alerts',
});

const dnsStack = new DnsStack(app, 'DnsStack', {
  env: envs.prod,
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
import * as ssm from 'aws-cdk-lib/aws-ssm';
const certParamsStack = new cdk.Stack(app, 'CertificateParametersStack', {
  env: envs.prod,
  crossRegionReferences: true,
  description: 'Mirror certificate ARNs to us-east-2 SSM',
});
certParamsStack.addDependency(certStack);

new ssm.StringParameter(certParamsStack, 'WildcardCertArnParamUsEast2', {
  parameterName: '/platform/certs/us-east-1/wildcard-arn',
  stringValue: certStack.wildcardCert.certificateArn,
  description: 'Wildcard certificate ARN for *.stevenclarke.dev (mirrored to us-east-2)',
});

new ssm.StringParameter(certParamsStack, 'SquatMonsterWildcardCertArnParamUsEast2', {
  parameterName: '/platform/certs/us-east-1/squat-monster-wildcard-arn',
  stringValue: certStack.squatMonsterWildcardCert.certificateArn,
  description: 'Squat Monster wildcard certificate ARN (mirrored to us-east-2)',
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

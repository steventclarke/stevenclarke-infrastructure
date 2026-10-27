#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { envs } from '../config/environments';

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

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

import { DnsStack } from '../lib/dns-stack';

new DnsStack(app, 'DnsStack', {
  env: envs.prod,
  description: 'Route 53 hosted zone for stevenclarke.dev',
});

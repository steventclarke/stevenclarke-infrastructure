#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { envs } from '../config/environments';

const app = new cdk.App();

const tags = {
  project: 'stevenclarke-infrastructure',
  owner: 'stevenclarke',
  managedBy: 'cdk',
};

// Developer role (bootstrap human access)
new DeveloperRoleStack(app, 'DeveloperRoleStack', {
  env: envs.prod,
  description: 'DeveloperRole for troubleshooting',
  tags,
});

// Monitoring (Budget + alerts)
new MonitoringStack(app, 'MonitoringStack', {
  env: envs.prod,
  description: 'Budget and monitoring alerts',
  tags,
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { envs } from '../config/environments';

const app = new cdk.App();

// Environment selection - default to preview for safety when deploying from workstation
const environment = app.node.tryGetContext('environment') || 'preview';

// Apply tags to all resources
Tags.of(app).add('Environment', environment);
Tags.of(app).add('Project', 'stevenclarke-infrastructure');
Tags.of(app).add('Owner', 'stevenclarke');
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Application', 'platform');

// Developer role for preview deployments from workstation and read-only prod troubleshooting
new DeveloperRoleStack(app, 'DeveloperRoleStack', {
  env: envs.prod,
  description: 'Developer role for preview deployments from workstation and read-only prod troubleshooting',
  tags: {
    Environment: environment,
    Project: 'stevenclarke-infrastructure',
    Owner: 'stevenclarke',
    ManagedBy: 'cdk',
    Application: 'platform',
  },
});

// Monitoring (Budget + alerts)
new MonitoringStack(app, `${environment}-MonitoringStack`, {
  env: envs.prod,
  description: 'Budget and monitoring alerts',
  tags: {
    Environment: environment,
    Project: 'stevenclarke-infrastructure',
    Owner: 'stevenclarke',
    ManagedBy: 'cdk',
    Application: 'platform',
  },
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

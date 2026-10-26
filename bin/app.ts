#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { DeveloperRoleStack } from '../lib/developer-role-stack';
import { DeveloperPreviewRoleStack } from '../lib/developer-preview-role-stack';
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

const commonProps = {
  env: envs.prod,
  tags: {
    Environment: environment,
    Project: 'stevenclarke-infrastructure',
    Owner: 'stevenclarke',
    ManagedBy: 'cdk',
    Application: 'platform',
  },
};

// Developer role (bootstrap human access)
new DeveloperRoleStack(app, `${environment}-DeveloperRoleStack`, {
  ...commonProps,
  description: `DeveloperRole for troubleshooting (${environment})`,
});

// Developer preview role for workstation deployments
if (environment === 'preview') {
  new DeveloperPreviewRoleStack(app, 'DeveloperPreviewRoleStack', {
    ...commonProps,
    description: 'Developer role for preview deployments from workstation',
  });
}

// Monitoring (Budget + alerts)
new MonitoringStack(app, `${environment}-MonitoringStack`, {
  ...commonProps,
  description: 'Budget and monitoring alerts',
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
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

// Application/platform stacks go here - prefix with environment for preview
// Example: new MyStack(app, `${environment}-MyStack`, {...});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

import { DnsStack } from '../lib/dns-stack';

// DNS stack - deployed with environment context but zone is global
new DnsStack(app, `${environment}-DnsStack`, {
  env: envs.prod,
  description: `Route 53 hosted zone for stevenclarke.dev (${environment})`,
  tags: {
    Environment: environment,
    Project: 'stevenclarke-infrastructure',
    Owner: 'stevenclarke',
    ManagedBy: 'cdk',
    Application: 'platform',
  },
});

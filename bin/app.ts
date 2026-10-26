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

// Application/platform stacks go here

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// The platform is a single global deployment target for the account; there is no
// preview/prod split for this repository. Tenant applications manage their own
// preview/prod environments independently.
Tags.of(app).add('Project', 'stevenclarke-infrastructure');
Tags.of(app).add('Owner', 'stevenclarke');
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Application', 'platform');

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class DeveloperPreviewRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Policy that allows actions on resources tagged with Environment=preview
    const previewPolicy = new iam.ManagedPolicy(this, 'DeveloperPreviewPolicy', {
      managedPolicyName: 'DeveloperPreviewPolicy',
      description: 'Allow developers to manage preview environment resources',
      statements: [
        // Allow most operations on preview-tagged resources
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:*',
            'cloudfront:*',
            'ec2:*',
            'ecs:*',
            'ecr:*',
            'logs:*',
            'route53:*',
            'acm:*',
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/Environment': 'preview',
            },
          },
        }),
        // CloudFormation needs to be able to create/update stacks
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cloudformation:CreateStack',
            'cloudformation:UpdateStack',
            'cloudformation:DeleteStack',
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeStackResources',
            'cloudformation:GetTemplate',
            'cloudformation:ValidateTemplate',
            'cloudformation:CreateChangeSet',
            'cloudformation:ExecuteChangeSet',
            'cloudformation:DeleteChangeSet',
            'cloudformation:DescribeChangeSet',
          ],
          resources: [`arn:aws:cloudformation:*:${this.account}:stack/preview-*/*`],
        }),
        // CDK bootstrap and asset operations
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:ListBucket',
            's3:DeleteObject',
          ],
          resources: [
            `arn:aws:s3:::cdk-*-${this.account}-*`,
            `arn:aws:s3:::cdk-*-${this.account}-*/*`,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
        }),
        // IAM pass role for services
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'iam:PassedToService': [
                'ecs.amazonaws.com',
                'lambda.amazonaws.com',
                'ec2.amazonaws.com',
              ],
            },
          },
        }),
      ],
    });

    // Explicit deny for prod resources
    const denyProdPolicy = new iam.ManagedPolicy(this, 'DenyProdPolicy', {
      managedPolicyName: 'DenyProdResources',
      description: 'Explicitly deny access to production resources',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ['*'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/Environment': 'prod',
            },
          },
        }),
      ],
    });

    const devPreviewRole = new iam.Role(this, 'DeveloperPreviewRole', {
      roleName: 'DeveloperPreviewRole',
      assumedBy: new iam.AccountPrincipal(this.account),
      description: 'Developer role for deploying to preview environment from workstation',
      managedPolicies: [previewPolicy, denyProdPolicy],
    });

    NagSuppressions.addResourceSuppressions(devPreviewRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using managed policies for role composition.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Some wildcard permissions needed for CDK operations.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressions(previewPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard resources/actions needed for CDK bootstrap and cross-service preview deployments.',
        appliesTo: [
          'Action::acm:*',
          'Action::cloudfront:*',
          'Action::ec2:*',
          'Action::ecs:*',
          'Action::ecr:*',
          'Action::logs:*',
          'Action::route53:*',
          'Action::s3:*',
          'Resource::*',
          'Resource::arn:aws:cloudformation:*:470805152888:stack/preview-*/*',
          'Resource::arn:aws:s3:::cdk-*-470805152888-*',
          'Resource::arn:aws:s3:::cdk-*-470805152888-*/*',
          'Resource::arn:aws:iam::470805152888:role/cdk-*',
        ],
      },
    ]);

    new cdk.CfnOutput(this, 'DeveloperPreviewRoleArn', {
      value: devPreviewRole.roleArn,
      exportName: 'DeveloperPreviewRoleArn',
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class DeveloperRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = this.account;

    // Policy for preview environment - allow CDK deployments
    const previewDeployPolicy = new iam.ManagedPolicy(this, 'DeveloperPreviewDeployPolicy', {
      managedPolicyName: 'DeveloperPreviewDeployPolicy',
      description: 'Allow developers to deploy preview environment via CDK',
      statements: [
        // CloudFormation operations for preview stacks only
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
            'cloudformation:ListStackResources',
          ],
          resources: [`arn:aws:cloudformation:*:${accountId}:stack/preview-*/*`],
        }),
        // Manage preview-tagged resources
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
            'ssm:*',
            'lambda:*',
            'events:*',
            'apigateway:*',
            'elasticloadbalancing:*',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/Environment': 'preview',
            },
          },
        }),
        // CDK bootstrap asset operations
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:ListBucket',
            's3:GetBucketLocation',
          ],
          resources: [
            `arn:aws:s3:::cdk-*-${accountId}-*`,
            `arn:aws:s3:::cdk-*-${accountId}-*/*`,
          ],
        }),
        // Assume CDK roles
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${accountId}:role/cdk-*`],
        }),
        // Pass roles to services for preview resources
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
                'events.amazonaws.com',
                'apigateway.amazonaws.com',
              ],
            },
          },
        }),
      ],
    });

    // Read-only access for production
    const prodReadOnlyPolicy = new iam.ManagedPolicy(this, 'DeveloperProdReadOnlyPolicy', {
      managedPolicyName: 'DeveloperProdReadOnlyPolicy',
      description: 'Read-only access to production environment for troubleshooting',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:Get*',
            's3:List*',
            'cloudfront:Get*',
            'cloudfront:List*',
            'cloudfront:Describe*',
            'ec2:Describe*',
            'ec2:Get*',
            'ecs:Describe*',
            'ecs:List*',
            'ecr:Describe*',
            'ecr:Get*',
            'ecr:List*',
            'logs:Get*',
            'logs:Describe*',
            'logs:FilterLogEvents',
            'logs:List*',
            'logs:Tail*',
            'route53:Get*',
            'route53:List*',
            'route53:TestDNSAnswer',
            'route53:GetHostedZoneCount',
            'route53:ListHostedZonesByName',
            'acm:Describe*',
            'acm:Get*',
            'acm:List*',
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
            'ssm:DescribeParameters',
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeStackResources',
            'cloudformation:GetTemplate',
            'cloudformation:ListStacks',
            'cloudwatch:Get*',
            'cloudwatch:List*',
            'cloudwatch:Describe*',
            'lambda:Get*',
            'lambda:List*',
            'apigateway:GET',
            'iam:Get*',
            'iam:List*',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/Environment': 'prod',
            },
          },
        }),
      ],
    });

    const devRole = new iam.Role(this, 'DeveloperRole', {
      roleName: 'DeveloperRole',
      assumedBy: new iam.AccountPrincipal(accountId),
      description: 'Developer role: deploy to preview via CDK, read-only to prod and ops',
      managedPolicies: [previewDeployPolicy, prodReadOnlyPolicy],
    });

    // Explicit denies
    devRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ['*'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:ResourceTag/Environment': 'prod',
          },
        },
      })
    );

    // Deny modifications to operational stacks
    devRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:CreateChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
        ],
        resources: [
          `arn:aws:cloudformation:*:${accountId}:stack/DeveloperRoleStack/*`,
          `arn:aws:cloudformation:*:${accountId}:stack/MonitoringStack/*`,
        ],
      })
    );

    // Deny self-modification
    devRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:UpdateRole',
          'iam:UpdateAssumeRolePolicy',
          'iam:DeleteRole',
          'iam:CreatePolicy',
          'iam:DeletePolicy',
          'iam:CreatePolicyVersion',
          'iam:DeletePolicyVersion',
          'iam:AttachUserPolicy',
          'iam:DetachUserPolicy',
          'iam:PutUserPolicy',
        ],
        resources: [devRole.roleArn, `arn:aws:iam::${accountId}:policy/Developer*`],
      })
    );

    NagSuppressions.addResourceSuppressions(devRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using managed policies for role composition.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Permissions required for CDK preview deployments and troubleshooting.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressions(previewDeployPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard resources needed for CDK operations and preview deployments.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressions(prodReadOnlyPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Read-only wildcard permissions for troubleshooting.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Developer role requires broad permissions for preview CDK deployments with explicit denies.',
      },
    ]);

    new cdk.CfnOutput(this, 'DeveloperRoleArn', {
      value: devRole.roleArn,
      exportName: 'DeveloperRoleArn',
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class DeveloperRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Policy for preview environment - full management
    const previewPolicy = new iam.ManagedPolicy(this, 'DeveloperPreviewPolicy', {
      managedPolicyName: 'DeveloperPreviewPolicy',
      description: 'Allow developers to manage preview environment resources',
      statements: [
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
            'budgets:*',
            'sns:*',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/Environment': 'preview',
            },
          },
        }),
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

    // Policy for production environment - read-only for troubleshooting
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
            'ec2:Describe*',
            'ecs:Describe*',
            'ecs:List*',
            'ecr:Describe*',
            'ecr:List*',
            'logs:Get*',
            'logs:Describe*',
            'logs:FilterLogEvents',
            'route53:Get*',
            'route53:List*',
            'acm:Describe*',
            'acm:List*',
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeStackResources',
            'cloudformation:GetTemplate',
            'budgets:ViewBudget',
            'sns:Get*',
            'sns:List*',
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
      assumedBy: new iam.AccountPrincipal(this.account),
      description: 'Developer role for preview deployments from workstation and read-only prod troubleshooting',
      managedPolicies: [previewPolicy, prodReadOnlyPolicy],
    });

    NagSuppressions.addResourceSuppressions(devRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using managed policies for role composition.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Some wildcard permissions needed for CDK operations and read-only access.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressions(previewPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard resources/actions needed for CDK bootstrap and preview deployments.',
        appliesTo: [
          'Action::acm:*',
          'Action::cloudfront:*',
          'Action::ec2:*',
          'Action::ecs:*',
          'ecr:*',
          'logs:*',
          'route53:*',
          's3:*',
          'budgets:*',
          'sns:*',
          'Resource::*',
          'Resource::arn:aws:cloudformation:*:470805152888:stack/preview-*/*',
          'Resource::arn:aws:s3:::cdk-*-470805152888-*',
          'Resource::arn:aws:s3:::cdk-*-470805152888-*/*',
          'Resource::arn:aws:iam::470805152888:role/cdk-*',
        ],
      },
    ]);

    NagSuppressions.addResourceSuppressions(prodReadOnlyPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Read-only wildcard permissions scoped by resource tags.',
        appliesTo: [
          'Action::acm:Describe*',
          'Action::acm:List*',
          'Action::cloudfront:Get*',
          'Action::cloudfront:List*',
          'Action::ec2:Describe*',
          'Action::ecs:Describe*',
          'Action::ecs:List*',
          'Action::ecr:Describe*',
          'Action::ecr:List*',
          'Action::logs:Get*',
          'Action::logs:Describe*',
          'Action::logs:FilterLogEvents',
          'Action::route53:Get*',
          'Action::route53:List*',
          'Action::s3:Get*',
          'Action::s3:List*',
          'Action::cloudformation:DescribeStacks',
          'Action::cloudformation:DescribeStackEvents',
          'Action::cloudformation:DescribeStackResources',
          'Action::cloudformation:GetTemplate',
          'Action::budgets:ViewBudget',
          'Action::sns:Get*',
          'Action::sns:List*',
          'Resource::*',
        ],
      },
    ]);


    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Developer role requires broad permissions for preview deployments with tag-based conditions.',
      },
    ]);

        new cdk.CfnOutput(this, 'DeveloperRoleArn', {
      value: devRole.roleArn,
      exportName: 'DeveloperRoleArn',
    });
  }
}

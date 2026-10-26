import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class DeveloperRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Read-only access to all resources for troubleshooting
    const developerReadOnlyPolicy = new iam.ManagedPolicy(this, 'DeveloperReadOnlyPolicy', {
      managedPolicyName: 'DeveloperReadOnlyPolicy',
      description: 'Read-only access for developer troubleshooting and log viewing',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:Get*',
            's3:List*',
            's3:Describe*',
            'cloudfront:Get*',
            'cloudfront:List*',
            'cloudfront:Describe*',
            'ec2:Describe*',
            'ec2:Get*',
            'ecs:Describe*',
            'ecs:List*',
            'ecs:Get*',
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
            'budgets:ViewBudget',
            'budgets:Describe*',
            'sns:Get*',
            'sns:List*',
            'iam:Get*',
            'iam:List*',
          ],
          resources: ['*'],
        }),
      ],
    });

    const devRole = new iam.Role(this, 'DeveloperRole', {
      roleName: 'DeveloperRole',
      assumedBy: new iam.AccountPrincipal(this.account),
      description: 'Read-only developer role for troubleshooting and log viewing',
      managedPolicies: [developerReadOnlyPolicy],
    });

    NagSuppressions.addResourceSuppressions(devRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using managed policy for role composition.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Read-only wildcard permissions required for troubleshooting across services.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressions(developerReadOnlyPolicy, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Read-only wildcard permissions required for troubleshooting across services.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Read-only developer role requires broad read permissions for troubleshooting.',
      },
    ]);

    new cdk.CfnOutput(this, 'DeveloperRoleArn', {
      value: devRole.roleArn,
      exportName: 'DeveloperRoleArn',
    });
  }
}

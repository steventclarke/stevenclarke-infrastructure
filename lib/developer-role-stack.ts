import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class DeveloperRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const devRole = new iam.Role(this, 'DeveloperRole', {
      roleName: 'DeveloperRole',
      assumedBy: new iam.AccountPrincipal(this.account),
      description: 'Developer role for troubleshooting and console access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    NagSuppressions.addResourceSuppressions(devRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Bootstrap developer role uses AWS managed AdministratorAccess for initial account setup; will be replaced with scoped permissions if needed.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AdministratorAccess'],
      },
    ]);

    new cdk.CfnOutput(this, 'DeveloperRoleArn', {
      value: devRole.roleArn,
      exportName: 'DeveloperRoleArn',
    });
  }
}

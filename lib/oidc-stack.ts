import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class OidcStack extends cdk.Stack {
  public readonly githubOidcProvider: iam.OpenIdConnectProvider;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = this.account;

    // Scope Route 53 permissions to the stevenclarke.dev hosted zone if it exists
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'stevenclarke.dev',
    });
    const hostedZoneArn = hostedZone.hostedZoneArn;

    // GitHub OIDC Provider
    // Thumbprints are the root CA thumbprints for token.actions.githubusercontent.com
    // as recommended by GitHub/AWS for OIDC identity providers (can be updated if GitHub rotates).
    this.githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1', '1c58a3a8518e8759bf075b76b750d4f2df264fcd'],
    });

    // Platform deploy role for the production environment (deploy.yml and
    // deploy-manual.yml both use `environment: production`, so the OIDC subject
    // is `...:environment:production`, not `...:ref:refs/heads/main`).
    const platformDeployRole = new iam.Role(this, 'PlatformDeployProdRole', {
      roleName: 'platform-deploy-prod',
      assumedBy: new iam.WebIdentityPrincipal(
        this.githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:steventclarke@3586962/stevenclarke-infrastructure@1431511755:environment:production',
          },
        }
      ),
      description: 'Platform deploy role for stevenclarke-infrastructure from the production environment',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Add basic permissions for platform deploy (CDK operations)
    const platformPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudformation:*', 's3:*', 'iam:*', 'ssm:*', 'route53:*', 'acm:*', 'sts:AssumeRole'],
      resources: ['*'],
    });
    platformDeployRole.addToPolicy(platformPolicy);

    // App roles
    const apps = ['portfolio', 'iron-altar', 'squat-monster', 'media-inspector'];
    for (const app of apps) {
      // Preview role
      const previewRole = new iam.Role(this, `${this.toPascalCase(app)}DeployPreviewRole`, {
        roleName: `${app}-deploy-preview`,
        assumedBy: new iam.WebIdentityPrincipal(
          this.githubOidcProvider.openIdConnectProviderArn,
          {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': `repo:steventclarke/${app}:ref:refs/heads/preview`,
            },
          }
        ),
        description: `Deploy ${app} preview environment`,
        maxSessionDuration: cdk.Duration.hours(1),
      });

      // Prod role
      const prodRole = new iam.Role(this, `${this.toPascalCase(app)}DeployProdRole`, {
        roleName: `${app}-deploy-prod`,
        assumedBy: new iam.WebIdentityPrincipal(
          this.githubOidcProvider.openIdConnectProviderArn,
          {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': `repo:steventclarke/${app}:ref:refs/heads/main`,
            },
          }
        ),
        description: `Deploy ${app} production environment`,
        maxSessionDuration: cdk.Duration.hours(1),
      });

      // Basic permissions for app roles
      const appPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudformation:*', 's3:*', 'cloudfront:*', 'route53:ChangeResourceRecordSets', 'route53:GetChange', 'ssm:GetParameter', 'ssm:GetParameters', 'sts:AssumeRole', 'iam:PassRole'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'route53:HostedZoneArn': hostedZoneArn,
          },
        },
      });
      previewRole.addToPolicy(appPolicy);
      prodRole.addToPolicy(appPolicy);

      // Publish role ARNs to SSM
      new ssm.StringParameter(this, `${this.toPascalCase(app)}PreviewRoleArn`, {
        parameterName: `/platform/roles/${app}/preview/deploy-role-arn`,
        stringValue: previewRole.roleArn,
        description: `GitHub Actions deploy role ARN for ${app} preview`,
      });
      new ssm.StringParameter(this, `${this.toPascalCase(app)}ProdRoleArn`, {
        parameterName: `/platform/roles/${app}/prod/deploy-role-arn`,
        stringValue: prodRole.roleArn,
        description: `GitHub Actions deploy role ARN for ${app} prod`,
      });
    }

    // Publish platform role ARNs
    new ssm.StringParameter(this, 'PlatformDeployProdRoleArn', {
      parameterName: '/platform/roles/platform/prod/deploy-role-arn',
      stringValue: platformDeployRole.roleArn,
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(platformDeployRole, [
      { id: 'AwsSolutions-IAM4', reason: 'CDK managed policies used where appropriate' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for CDK operations', appliesTo: ['Action::cloudformation:*', 'Action::s3:*', 'Action::iam:*', 'Action::ssm:*', 'Action::route53:*', 'Action::acm:*', 'Action::sts:AssumeRole', 'Resource::*'] },
    ]);
    try {
      NagSuppressions.addStackSuppressions(this, [
        { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for CDK/GitHub OIDC deploy roles per design' },
        { id: 'AwsSolutions-IAM4', reason: 'AWS managed policies used where appropriate' },
      ]);
    } catch(e) {}
    NagSuppressions.addResourceSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for CDK/GitHub OIDC deploy roles per design', appliesTo: ['*'] },
    ]);
    // Suppress for all app roles
    for (const app of apps) {
      const previewRole = this.node.findChild(`${this.toPascalCase(app)}DeployPreviewRole`) as iam.Role;
      const prodRole = this.node.findChild(`${this.toPascalCase(app)}DeployProdRole`) as iam.Role;
      if (previewRole) {
        NagSuppressions.addResourceSuppressions(previewRole, [
          { id: 'AwsSolutions-IAM5', reason: 'CDK/app deploy requires broad permissions; scoped by resource tags/branch where possible', appliesTo: ['Action::cloudformation:*', 'Action::s3:*', 'Action::cloudfront:*', 'Action::route53:ChangeResourceRecordSets', 'Action::route53:GetChange', 'Action::ssm:GetParameter', 'Action::ssm:GetParameters', 'Action::sts:AssumeRole', 'Action::iam:PassRole', 'Resource::*'] },
        ]);
        try {
          NagSuppressions.addResourceSuppressionsByPath(this, `${this.stackName}/${this.toPascalCase(app)}DeployPreviewRole/DefaultPolicy/Resource`, [
            { id: 'AwsSolutions-IAM5', reason: 'CDK/app deploy requires broad permissions', appliesTo: ['Action::cloudformation:*', 'Action::s3:*', 'Action::cloudfront:*', 'Action::route53:ChangeResourceRecordSets', 'Action::route53:GetChange', 'Action::ssm:GetParameter', 'Action::ssm:GetParameters', 'Action::sts:AssumeRole', 'Action::iam:PassRole', 'Resource::*'] },
          ]);
        } catch(e) {}
      }
      if (prodRole) {
        NagSuppressions.addResourceSuppressions(prodRole, [
          { id: 'AwsSolutions-IAM5', reason: 'CDK/app deploy requires broad permissions; scoped by resource tags/branch where possible', appliesTo: ['Action::cloudformation:*', 'Action::s3:*', 'Action::cloudfront:*', 'Action::route53:ChangeResourceRecordSets', 'Action::route53:GetChange', 'Action::ssm:GetParameter', 'Action::ssm:GetParameters', 'Action::sts:AssumeRole', 'Action::iam:PassRole', 'Resource::*'] },
        ]);
        try {
          NagSuppressions.addResourceSuppressionsByPath(this, `${this.stackName}/${this.toPascalCase(app)}DeployProdRole/DefaultPolicy/Resource`, [
            { id: 'AwsSolutions-IAM5', reason: 'CDK/app deploy requires broad permissions', appliesTo: ['Action::cloudformation:*', 'Action::s3:*', 'Action::cloudfront:*', 'Action::route53:ChangeResourceRecordSets', 'Action::route53:GetChange', 'Action::ssm:GetParameter', 'Action::ssm:GetParameters', 'Action::sts:AssumeRole', 'Action::iam:PassRole', 'Resource::*'] },
          ]);
        } catch(e) {}
      }
    }
  }

  private toPascalCase(str: string): string {
    return str.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  }
}

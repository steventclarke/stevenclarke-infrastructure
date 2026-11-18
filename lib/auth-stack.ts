import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { authConfig } from '../config/auth';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const googleClientId = ssm.StringParameter.fromStringParameterName(
      this,
      'GoogleClientId',
      authConfig.googleClientIdParameterName
    ).stringValue;
    const googleClientSecret = cdk.SecretValue.secretsManager(
      authConfig.googleClientSecretName
    );

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: authConfig.userPoolName,
      selfSignUpEnabled: false,
      signInAliases: { username: false, email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
        profilePicture: { required: false, mutable: true },
      },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(1),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: true,
    });

    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.overrideLogicalId('UserPoolMutableEmail');

    new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecretValue: googleClientSecret,
      scopes: ['openid', 'email', 'profile'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    const domain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: authConfig.domainPrefix },
    });
    domain.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;

    new ssm.StringParameter(this, 'UserPoolIdParameter', {
      parameterName: '/platform/auth/user-pool-id',
      stringValue: this.userPool.userPoolId,
      description: 'Shared Cognito user pool ID for tenant apps',
    });
    new ssm.StringParameter(this, 'UserPoolArnParameter', {
      parameterName: '/platform/auth/user-pool-arn',
      stringValue: this.userPool.userPoolArn,
      description: 'Shared Cognito user pool ARN for tenant app IAM policies',
    });
    new ssm.StringParameter(this, 'DomainParameter', {
      parameterName: '/platform/auth/domain',
      stringValue: `${domain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Shared Cognito Hosted UI domain for tenant apps',
    });
    new ssm.StringParameter(this, 'IssuerParameter', {
      parameterName: '/platform/auth/issuer',
      stringValue: issuer,
      description: 'OIDC issuer for tenant app token validation',
    });
    new ssm.StringParameter(this, 'JwksUriParameter', {
      parameterName: '/platform/auth/jwks-uri',
      stringValue: `${issuer}/.well-known/jwks.json`,
      description: 'JWKS endpoint for tenant app token validation',
    });

    NagSuppressions.addResourceSuppressions(this.userPool, [
      {
        id: 'AwsSolutions-COG2',
        reason: 'Google is the only identity provider and enforces its own MFA; Cognito MFA would duplicate the challenge and add SMS cost.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason: 'The Cognito Plus feature plan would exceed the $10/month platform budget; the standard tier is an explicit cost decision.',
      },
    ]);
  }
}

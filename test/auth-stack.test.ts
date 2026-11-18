import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

function buildTemplate(): Template {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuthStack', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  return Template.fromStack(stack);
}

test('creates a shared user pool with Google as the only federated IdP', () => {
  const template = buildTemplate();

  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    UserPoolName: 'stevenclarke-users',
    MfaConfiguration: 'OFF',
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    Policies: {
      PasswordPolicy: Match.objectLike({
        MinimumLength: 12,
        RequireUppercase: true,
        RequireLowercase: true,
        RequireNumbers: true,
        RequireSymbols: true,
      }),
    },
  });
  template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
    ProviderName: 'Google',
    ProviderType: 'Google',
    AttributeMapping: Match.objectLike({
      email: 'email',
      email_verified: 'email_verified',
      given_name: 'given_name',
      family_name: 'family_name',
      picture: 'picture',
    }),
  });
  template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
});

test('keeps email mutable so Google can rewrite it on every federated sign-in', () => {
  buildTemplate().hasResourceProperties('AWS::Cognito::UserPool', {
    Schema: Match.arrayWith([
      Match.objectLike({
        Name: 'email',
        Mutable: true,
        Required: true,
      }),
    ]),
  });
});

test('forces a replacement pool because email mutability cannot change in place', () => {
  expect(Object.keys(buildTemplate().findResources('AWS::Cognito::UserPool'))).toContain(
    'UserPoolMutableEmail'
  );
});

test('creates a Cognito-provided hosted UI domain', () => {
  buildTemplate().hasResourceProperties('AWS::Cognito::UserPoolDomain', {
    Domain: 'stevenclarke',
  });
});

test('publishes the auth SSM contract', () => {
  const parameters = Object.values(
    buildTemplate().findResources('AWS::SSM::Parameter')
  ).map((parameter: any) => parameter.Properties.Name);

  expect(parameters).toEqual(
    expect.arrayContaining([
      '/platform/auth/user-pool-id',
      '/platform/auth/user-pool-arn',
      '/platform/auth/domain',
      '/platform/auth/issuer',
      '/platform/auth/jwks-uri',
    ])
  );
});

test('resolves Google credentials through dynamic references, never literals', () => {
  const template = JSON.stringify(buildTemplate().toJSON());

  expect(template).toContain(
    '{{resolve:secretsmanager:platform/google-oauth-client:SecretString:::}}'
  );
  expect(template).not.toContain('{{resolve:secretsmanager:arn:');
  expect(template).toContain('"AWS::SSM::Parameter::Value<String>"');
  expect(template).not.toContain('client-secret-value');
  expect(template).not.toContain('client-id-value');
});

test('retains the user pool so federated users survive stack deletion', () => {
  buildTemplate().hasResource('AWS::Cognito::UserPool', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
});

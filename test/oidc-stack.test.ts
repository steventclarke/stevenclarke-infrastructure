import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ArtifactsStack } from '../lib/artifacts-stack';
import { OidcStack } from '../lib/oidc-stack';

const env = { account: '123456789012', region: 'us-east-2' };

function createOidcTemplate(): Template {
  const app = new cdk.App({
    context: {
      [`hosted-zone:account=${env.account}:domainName=stevenclarke.dev:region=${env.region}`]: {
        Id: '/hostedzone/TESTHOSTEDZONE',
        Name: 'stevenclarke.dev.',
      },
    },
  });
  const artifactsStack = new ArtifactsStack(app, 'TestArtifacts', { env });
  const oidcStack = new OidcStack(app, 'TestOidc', {
    env,
    artifacts: artifactsStack.artifacts,
  });
  return Template.fromStack(oidcStack);
}

test('issue-reporter preview role trusts the repository OIDC subject', () => {
  const template = createOidcTemplate();

  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'issue-reporter-deploy-preview',
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: Match.objectLike({
            StringLike: Match.objectLike({
              'token.actions.githubusercontent.com:sub':
                'repo:steventclarke@3586962/issue-reporter@1460910484:environment:preview',
            }),
          }),
        }),
      ]),
    }),
  });
});

test('issue-reporter prod role trusts the repository OIDC subject', () => {
  const template = createOidcTemplate();

  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'issue-reporter-deploy-prod',
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: Match.objectLike({
            StringLike: Match.objectLike({
              'token.actions.githubusercontent.com:sub':
                'repo:steventclarke@3586962/issue-reporter@1460910484:environment:production',
            }),
          }),
        }),
      ]),
    }),
  });
});

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactsStack } from '../lib/artifacts-stack';
import { DeveloperRoleStack } from '../lib/developer-role-stack';

test('DeveloperRoleStack created', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-2' };
  const artifactsStack = new ArtifactsStack(app, 'TestArtifacts', { env });
  const stack = new DeveloperRoleStack(app, 'TestStack', {
    env,
    artifacts: artifactsStack.artifacts,
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'DeveloperRole',
  });
});

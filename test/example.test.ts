import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DeveloperRoleStack } from '../lib/developer-role-stack';

test('DeveloperRoleStack created', () => {
  const app = new cdk.App();
  const stack = new DeveloperRoleStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'DeveloperRole',
  });
});

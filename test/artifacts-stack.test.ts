import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ArtifactsStack, grantArtifactPublish, grantArtifactRead } from '../lib/artifacts-stack';

const account = '123456789012';
const region = 'us-east-2';

function createStack(): ArtifactsStack {
  const app = new cdk.App();
  cdk.Tags.of(app).add('Project', 'stevenclarke-infrastructure');
  cdk.Tags.of(app).add('Owner', 'stevenclarke');
  cdk.Tags.of(app).add('ManagedBy', 'cdk');
  cdk.Tags.of(app).add('Application', 'platform');
  return new ArtifactsStack(app, 'TestArtifactsStack', {
    env: { account, region },
  });
}

function buildStack() {
  const stack = createStack();
  return { stack, template: Template.fromStack(stack) };
}

test('creates a retained customer-managed KMS key for CodeArtifact', () => {
  const { template } = buildStack();

  template.resourceCountIs('AWS::KMS::Key', 1);
  template.hasResourceProperties('AWS::KMS::Alias', {
    AliasName: 'alias/stevenclarke-artifacts',
  });
  template.hasResourceProperties('AWS::KMS::Key', {
    Description: 'KMS key for the platform CodeArtifact domain',
    EnableKeyRotation: false,
    KeyPolicy: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AllowCodeArtifactGrants',
          Action: ['kms:CreateGrant', 'kms:DescribeKey'],
          Condition: Match.objectLike({
            StringEquals: Match.objectLike({
              'kms:CallerAccount': account,
              'kms:ViaService': 'codeartifact.us-east-2.amazonaws.com',
            }),
          }),
        }),
      ]),
    }),
  });
  template.hasResource('AWS::KMS::Key', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
});

test('creates the CodeArtifact domain, npm upstream, and shared repository', () => {
  const { template } = buildStack();

  template.hasResourceProperties('AWS::CodeArtifact::Domain', {
    DomainName: 'stevenclarke',
    EncryptionKey: Match.anyValue(),
  });
  template.hasResource('AWS::CodeArtifact::Domain', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });

  const repositories = Object.values(template.findResources('AWS::CodeArtifact::Repository')) as any[];
  expect(repositories).toHaveLength(2);

  const upstream = repositories.find((resource) => resource.Properties.RepositoryName === 'npmjs');
  expect(upstream.Properties.ExternalConnections).toEqual(['public:npmjs']);
  expect(upstream.DeletionPolicy).toBe('Retain');
  expect(upstream.UpdateReplacePolicy).toBe('Retain');

  const shared = repositories.find((resource) => resource.Properties.RepositoryName === 'shared');
  expect(shared.Properties.Upstreams).toEqual(['npmjs']);
  expect(shared.DeletionPolicy).toBe('Retain');
  expect(shared.UpdateReplacePolicy).toBe('Retain');
});

test('publishes the artifact SSM contract', () => {
  const parameters = Object.values(
    buildStack().template.findResources('AWS::SSM::Parameter')
  ).map((parameter: any) => parameter.Properties.Name);

  expect(parameters).toEqual(
    expect.arrayContaining([
      '/platform/artifacts/codeartifact/domain',
      '/platform/artifacts/codeartifact/domain-owner',
      '/platform/artifacts/codeartifact/region',
      '/platform/artifacts/codeartifact/repository',
      '/platform/artifacts/codeartifact/npm-registry-url',
      '/platform/artifacts/codeartifact/npm-scope',
    ])
  );
});

test('applies standard platform tags to artifact resources', () => {
  const { template } = buildStack();
  const domain = Object.values(template.findResources('AWS::CodeArtifact::Domain'))[0] as any;

  expect(domain.Properties.Tags).toEqual(
    expect.arrayContaining([
      { Key: 'Project', Value: 'stevenclarke-infrastructure' },
      { Key: 'Environment', Value: 'global' },
      { Key: 'Owner', Value: 'stevenclarke' },
      { Key: 'Application', Value: 'platform' },
      { Key: 'ManagedBy', Value: 'cdk' },
    ])
  );
});

test('grants scoped read and namespace-limited publish permissions', () => {
  const stack = createStack();
  const role = new iam.Role(stack, 'TestArtifactConsumer', {
    assumedBy: new iam.AccountPrincipal(account),
  });

  grantArtifactRead(role, stack.artifacts);
  grantArtifactPublish(role, stack.artifacts);

  const template = Template.fromStack(stack);
  const policies = Object.values(template.findResources('AWS::IAM::Policy')) as any[];
  const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
  const rendered = JSON.stringify(statements);

  expect(rendered).toContain('codeartifact:GetAuthorizationToken');
  expect(rendered).toContain('codeartifact:ReadFromRepository');
  expect(rendered).toContain('sts:GetServiceBearerToken');
  expect(rendered).toContain('codeartifact.amazonaws.com');
  expect(rendered).toContain('codeartifact:PublishPackageVersion');
  expect(rendered).toContain(`codeartifact:${region}:${account}:package/stevenclarke/shared/npm/@stevenclarke/*`);
  expect(rendered).not.toContain('codeartifact:*');
});

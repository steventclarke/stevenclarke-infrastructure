import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AnalyticsStack } from '../lib/analytics-stack';

function buildTemplate(): Template {
  const app = new cdk.App();
  const stack = new AnalyticsStack(app, 'TestAnalyticsStack', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  return Template.fromStack(stack);
}

test('reads the platform contract from SSM', () => {
  const parameters = buildTemplate().findParameters('*');
  const defaults = Object.values(parameters).map((parameter: any) => parameter.Default);

  expect(defaults).toEqual(
    expect.arrayContaining([
      '/platform/dns/hosted-zone-id',
      '/platform/dns/domain-name',
      '/platform/certs/us-east-1/wildcard-arn',
      '/platform/network/vpc-id',
      '/platform/network/public-subnet-1-id',
      '/platform/network/public-subnet-1-az',
      '/platform/monitoring/alerts-topic-arn',
    ])
  );
});

test('deploys a t4g.nano instance via a versioned launch template with IMDSv2', () => {
  const template = buildTemplate();

  const launchTemplates = Object.values(template.findResources('AWS::EC2::LaunchTemplate'));
  expect(launchTemplates).toHaveLength(1);
  const launchTemplateData = (launchTemplates[0] as any).Properties.LaunchTemplateData;
  expect(launchTemplateData.InstanceType).toBe('t4g.nano');
  expect(launchTemplateData.MetadataOptions).toEqual(
    expect.objectContaining({ HttpTokens: 'required' })
  );

  const instances = Object.values(template.findResources('AWS::EC2::Instance'));
  expect(instances).toHaveLength(1);
  // Pin the instance to the latest launch template version so bootstrap changes
  // replace the instance instead of only restarting it.
  expect((instances[0] as any).Properties.LaunchTemplate.Version).toEqual({
    'Fn::GetAtt': [expect.any(String), 'LatestVersionNumber'],
  });
});

function getUserDataScript(template: Template): string {
  const launchTemplates = Object.values(template.findResources('AWS::EC2::LaunchTemplate'));
  const userData = (launchTemplates[0] as any).Properties.LaunchTemplateData.UserData;
  const sub = userData['Fn::Base64']['Fn::Sub'];
  return Array.isArray(sub) ? sub[0] : sub;
}

test('writes the Litestream config before attempting a restore', () => {
  const lines = getUserDataScript(buildTemplate()).split('\n');

  const configIndex = lines.findIndex((line) => line === "cat > /etc/litestream.yml <<'EOF'");
  const restoreIndex = lines.findIndex((line) => line.includes('litestream restore'));

  expect(configIndex).toBeGreaterThan(-1);
  expect(restoreIndex).toBeGreaterThan(-1);
  expect(configIndex).toBeLessThan(restoreIndex);
  // Heredoc terminators must be at column 0 or the shell script breaks.
  expect(lines.some((line) => /^\s+EOF$/.test(line))).toBe(false);
});

test('creates the database when initializing the site', () => {
  const lines = getUserDataScript(buildTemplate()).split('\n');

  const createSiteIndex = lines.findIndex((line) => line.includes('goatcounter db create site'));
  expect(createSiteIndex).toBeGreaterThan(-1);
  // `db create site` refuses to run without an existing DB unless -createdb is
  // passed; under `set -euo pipefail` the omission aborts the whole bootstrap.
  const createSiteCommand = lines.slice(createSiteIndex, createSiteIndex + 8).join('\n');
  expect(createSiteCommand).toContain('-createdb');
});

test('retains the backup bucket so data survives stack teardown', () => {
  const template = buildTemplate();
  const buckets = Object.values(template.findResources('AWS::S3::Bucket'));

  expect(buckets).toHaveLength(1);
  const bucket = buckets[0] as any;
  expect(bucket.DeletionPolicy).toBe('Retain');
  expect(bucket.UpdateReplacePolicy).toBe('Retain');
  expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
});

test('publishes the analytics SSM contract', () => {
  const template = buildTemplate();
  const params = Object.values(template.findResources('AWS::SSM::Parameter'));

  const names = params.map((p: any) => p.Properties.Name);
  expect(names).toEqual(
    expect.arrayContaining([
      '/platform/analytics/provider',
      '/platform/analytics/domain',
      '/platform/analytics/script-url',
      '/platform/analytics/dashboard-url',
    ])
  );
  const provider = params.find((p: any) => p.Properties.Name === '/platform/analytics/provider') as any;
  expect(provider.Properties.Value).toBe('GoatCounter');
});

test('creates A and AAAA records for the analytics hostname', () => {
  const template = buildTemplate();
  const records = Object.values(template.findResources('AWS::Route53::RecordSet'));

  expect(records.map((r: any) => r.Properties.Type).sort()).toEqual(['A', 'AAAA']);
  records.forEach((record: any) => {
    const nameJoin = record.Properties.Name['Fn::Join'];
    expect(nameJoin[1][0]).toBe('analytics.');
    expect(record.Properties.AliasTarget).toEqual(
      expect.objectContaining({
        HostedZoneId: expect.any(Object),
        DNSName: expect.any(Object),
      })
    );
  });
});

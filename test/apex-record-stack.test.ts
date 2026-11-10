import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApexRecordStack } from '../lib/apex-record-stack';

function buildTemplate(): Template {
  const app = new cdk.App();
  const stack = new ApexRecordStack(app, 'TestApexStack', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  return Template.fromStack(stack);
}

test('reads the zone and portfolio distribution from the SSM contract', () => {
  const parameters = buildTemplate().findParameters('*');
  const defaults = Object.values(parameters).map((parameter: any) => parameter.Default);

  expect(defaults).toEqual(
    expect.arrayContaining([
      '/platform/dns/hosted-zone-id',
      '/platform/dns/domain-name',
      '/app/portfolio/prod/cloudfront-domain',
    ])
  );
  Object.values(parameters).forEach((parameter: any) => {
    expect(parameter.Type).toBe('AWS::SSM::Parameter::Value<String>');
  });
});

test('creates apex A and AAAA alias records to the portfolio distribution', () => {
  const template = buildTemplate();
  const parameters = template.findParameters('*');
  const distributionParamId = Object.entries(parameters).find(
    ([, parameter]: [string, any]) =>
      parameter.Default === '/app/portfolio/prod/cloudfront-domain'
  )?.[0];

  const records = Object.values(template.findResources('AWS::Route53::RecordSet'));

  expect(records).toHaveLength(2);
  expect(records.map((record: any) => record.Properties.Type).sort()).toEqual(['A', 'AAAA']);

  records.forEach((record: any) => {
    expect(record.Properties.AliasTarget).toEqual({
      HostedZoneId: 'Z2FDTNDATAQYW2',
      DNSName: { Ref: distributionParamId },
    });
  });
});

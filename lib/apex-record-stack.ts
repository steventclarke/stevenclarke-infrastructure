import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// CloudFront's fixed hosted zone ID, used for all Route 53 alias records to
// CloudFront distributions.
const CLOUDFRONT_HOSTED_ZONE_ID = 'Z2FDTNDATAQYW2';

// Published by the portfolio repository (see its CDK stack) for the production
// distribution. The platform owns the apex record but not the distribution.
const PORTFOLIO_DISTRIBUTION_PARAM = '/app/portfolio/prod/cloudfront-domain';

export class ApexRecordStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Read the shared zone from the platform SSM contract instead of performing
    // an environment lookup, so synth does not depend on cached CDK context or
    // AWS credentials. Both values are resolved at deploy time.
    const hostedZoneId = ssm.StringParameter.valueForStringParameter(
      this,
      '/platform/dns/hosted-zone-id'
    );
    const domainName = ssm.StringParameter.valueForStringParameter(
      this,
      '/platform/dns/domain-name'
    );

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: domainName,
    });

    // The portfolio publishes its production CloudFront distribution domain
    // (e.g. d1234.cloudfront.net) to SSM. Resolving it as a CloudFormation
    // parameter reads the value at deploy time, after the portfolio has
    // published the handoff.
    const distributionDomain = ssm.StringParameter.valueForStringParameter(
      this,
      PORTFOLIO_DISTRIBUTION_PARAM
    );

    const aliasTarget = route53.RecordTarget.fromAlias({
      bind: () => ({
        hostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
        dnsName: distributionDomain,
      }),
    });

    // IPv4 and IPv6 aliases to the same distribution. CloudFront has IPv6
    // enabled by default, so both record types are safe to create. The record
    // name defaults to the zone name, which makes this the apex record.
    new route53.ARecord(this, 'ApexARecord', {
      zone: hostedZone,
      target: aliasTarget,
    });

    new route53.AaaaRecord(this, 'ApexAaaaRecord', {
      zone: hostedZone,
      target: aliasTarget,
    });

    new cdk.CfnOutput(this, 'ApexRecordName', {
      value: hostedZone.zoneName,
      description: 'Apex record aliasing to the portfolio production CloudFront distribution',
    });
  }
}

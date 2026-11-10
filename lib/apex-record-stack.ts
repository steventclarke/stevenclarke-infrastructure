import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// CloudFront's fixed hosted zone ID, used for all Route 53 alias records to
// CloudFront distributions.
const CLOUDFRONT_HOSTED_ZONE_ID = 'Z2FDTNDATAQYW2';

export class ApexRecordStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'stevenclarke.dev',
    });

    // The portfolio publishes its production CloudFront distribution domain name
    // (e.g. d1234.cloudfront.net) to this SSM parameter. The apex record aliases
    // to that distribution so stevenclarke.dev serves the portfolio site.
    const distributionDomain = ssm.StringParameter.valueForStringParameter(
      this,
      '/app/portfolio/prod/cloudfront-domain'
    );

    new route53.ARecord(this, 'ApexRecord', {
      zone: hostedZone,
      recordName: 'stevenclarke.dev',
      target: route53.RecordTarget.fromAlias({
        bind: () => ({
          hostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
          dnsName: distributionDomain,
        }),
      }),
    });
  }
}

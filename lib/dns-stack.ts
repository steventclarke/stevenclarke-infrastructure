import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: 'stevenclarke.dev',
      comment: 'Platform hosted zone for stevenclarke.dev',
    });

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      description: 'Route 53 Hosted Zone ID',
    });

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(',', this.hostedZone.hostedZoneNameServers || []),
      description: 'Name servers to update in GoDaddy',
    });

    new ssm.StringParameter(this, 'HostedZoneIdParam', {
      parameterName: '/platform/dns/hosted-zone-id',
      stringValue: this.hostedZone.hostedZoneId,
      description: 'Route 53 hosted zone ID for stevenclarke.dev',
    });

    new ssm.StringParameter(this, 'DomainNameParam', {
      parameterName: '/platform/dns/domain-name',
      stringValue: 'stevenclarke.dev',
      description: 'Root domain name',
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CertificateStackProps extends cdk.StackProps {
  hostedZone: route53.IHostedZone;
}

export class CertificateStack extends cdk.Stack {
  public readonly wildcardCert: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    // Wildcard certificate for *.stevenclarke.dev and apex
    // Why only this wildcard is needed: ACM wildcards match only one level of
    // subdomains. The unified naming convention uses <app>.stevenclarke.dev,
    // <app>-preview.stevenclarke.dev, <app>-api.stevenclarke.dev, and
    // <app>-api-preview.stevenclarke.dev - all are direct subdomains of
    // stevenclarke.dev (one label below apex), so they are all covered by
    // *.stevenclarke.dev. We do not need a separate wildcard for deeper nesting
    // (e.g., *.squat-monster.stevenclarke.dev) because we flatten API hostnames
    // to <app>-api.stevenclarke.dev. This keeps the platform simple with no
    // per-application special-case certificates.
    this.wildcardCert = new acm.Certificate(this, 'WildcardCertificate', {
      domainName: 'stevenclarke.dev',
      subjectAlternativeNames: ['*.stevenclarke.dev'],
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    // Publish ARN to SSM in us-east-1 (where it is created)
    new ssm.StringParameter(this, 'WildcardCertArnParam', {
      parameterName: '/platform/certs/us-east-1/wildcard-arn',
      stringValue: this.wildcardCert.certificateArn,
      description: 'Wildcard certificate ARN for *.stevenclarke.dev (us-east-1 for CloudFront)',
    });

    new cdk.CfnOutput(this, 'WildcardCertificateArn', {
      value: this.wildcardCert.certificateArn,
      description: 'Wildcard certificate ARN for stevenclarke.dev',
    });
  }
}

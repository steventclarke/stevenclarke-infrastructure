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
  public readonly squatMonsterWildcardCert: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    // Wildcard certificate for *.stevenclarke.dev and apex
    this.wildcardCert = new acm.Certificate(this, 'WildcardCertificate', {
      domainName: 'stevenclarke.dev',
      subjectAlternativeNames: ['*.stevenclarke.dev'],
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    // Squat Monster wildcard certificate for *.squat-monster.stevenclarke.dev
    this.squatMonsterWildcardCert = new acm.Certificate(this, 'SquatMonsterWildcardCertificate', {
      domainName: '*.squat-monster.stevenclarke.dev',
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    // Publish ARNs to SSM in us-east-1 (where they are created)
    new ssm.StringParameter(this, 'WildcardCertArnParam', {
      parameterName: '/platform/certs/us-east-1/wildcard-arn',
      stringValue: this.wildcardCert.certificateArn,
      description: 'Wildcard certificate ARN for *.stevenclarke.dev (us-east-1 for CloudFront)',
    });

    new ssm.StringParameter(this, 'SquatMonsterWildcardCertArnParam', {
      parameterName: '/platform/certs/us-east-1/squat-monster-wildcard-arn',
      stringValue: this.squatMonsterWildcardCert.certificateArn,
      description: 'Squat Monster wildcard certificate ARN for *.squat-monster.stevenclarke.dev (us-east-1)',
    });

    new cdk.CfnOutput(this, 'WildcardCertificateArn', {
      value: this.wildcardCert.certificateArn,
      description: 'Wildcard certificate ARN for stevenclarke.dev',
    });

    new cdk.CfnOutput(this, 'SquatMonsterWildcardCertificateArn', {
      value: this.squatMonsterWildcardCert.certificateArn,
      description: 'Squat Monster wildcard certificate ARN',
    });
  }
}

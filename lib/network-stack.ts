import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cost-optimized VPC: no NAT Gateway, no NAT instances by default
    // Use public subnets only or isolated/private without egress; for static apps no VPC needed
    this.vpc = new ec2.Vpc(this, 'PlatformVpc', {
      vpcName: 'platform-vpc',
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Publish VPC and subnet IDs to SSM
    new ssm.StringParameter(this, 'VpcIdParam', {
      parameterName: '/platform/network/vpc-id',
      stringValue: this.vpc.vpcId,
      description: 'Shared platform VPC ID',
    });

    const subnetIds = this.vpc.isolatedSubnets.map(s => s.subnetId).concat(this.vpc.publicSubnets.map(s => s.subnetId));
    new ssm.StringParameter(this, 'SubnetIdsParam', {
      parameterName: '/platform/network/subnet-ids',
      stringValue: cdk.Fn.join(',', subnetIds),
      description: 'Subnet IDs available to applications',
    });

    // Publish the first public subnet for platform-managed single-instance
    // workloads (e.g. the GoatCounter analytics host). Kept as individual
    // parameters so consumers can reference a concrete subnet/AZ without a
    // synth-time VPC lookup.
    const publicSubnet = this.vpc.publicSubnets[0];
    new ssm.StringParameter(this, 'PublicSubnet1IdParam', {
      parameterName: '/platform/network/public-subnet-1-id',
      stringValue: publicSubnet.subnetId,
      description: 'First platform public subnet ID',
    });
    new ssm.StringParameter(this, 'PublicSubnet1AzParam', {
      parameterName: '/platform/network/public-subnet-1-az',
      stringValue: publicSubnet.availabilityZone,
      description: 'First platform public subnet availability zone',
    });

    NagSuppressions.addResourceSuppressions(this.vpc, [
      { id: 'AwsSolutions-VPC7', reason: 'Flow logs not enabled to minimize cost; can be added if needed' },
    ]);
  }
}

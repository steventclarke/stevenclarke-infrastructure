import * as cdk from 'aws-cdk-lib';
import * as codeartifact from 'aws-cdk-lib/aws-codeartifact';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { artifactConfig } from '../config/artifacts';

export interface ArtifactResources {
  readonly domainName: string;
  readonly domainOwner: string;
  readonly domainArn: string;
  readonly repositoryName: string;
  readonly sharedRepositoryArn: string;
  readonly upstreamRepositoryArn: string;
  readonly repositoryArns: string[];
  readonly packageArnPattern: string;
  readonly npmRegistryUrl: string;
  readonly npmScope: string;
  readonly region: string;
}

export class ArtifactsStack extends cdk.Stack {
  public readonly artifacts: ArtifactResources;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Environment', 'global');

    const key = new kms.Key(this, 'ArtifactKmsKey', {
      alias: artifactConfig.kmsKeyAlias,
      description: 'KMS key for the platform CodeArtifact domain',
      enableKeyRotation: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCodeArtifactGrants',
      effect: iam.Effect.ALLOW,
      principals: [new iam.AnyPrincipal()],
      actions: ['kms:CreateGrant', 'kms:DescribeKey'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'kms:CallerAccount': this.account,
          'kms:ViaService': `codeartifact.${this.region}.amazonaws.com`,
        },
      },
    }));

    NagSuppressions.addResourceSuppressions(key, [
      {
        id: 'AwsSolutions-KMS5',
        reason: 'Automatic rotation is disabled to keep the platform under the $10/month budget; the first two rotations would add $1/month each.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'The KMS key policy uses the wildcard resource form required by the AWS CodeArtifact key policy pattern, constrained by kms:ViaService and kms:CallerAccount.',
        appliesTo: ['Resource::*'],
      },
    ]);

    const domain = new codeartifact.CfnDomain(this, 'CodeArtifactDomain', {
      domainName: artifactConfig.domainName,
      encryptionKey: key.keyArn,
    });
    domain.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const upstreamRepository = new codeartifact.CfnRepository(this, 'NpmUpstreamRepository', {
      domainName: domain.attrName,
      domainOwner: this.account,
      repositoryName: artifactConfig.upstreamRepositoryName,
      description: 'Public npmjs cache for the platform CodeArtifact domain',
      externalConnections: ['public:npmjs'],
    });
    upstreamRepository.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    upstreamRepository.addDependency(domain);

    const sharedRepository = new codeartifact.CfnRepository(this, 'SharedRepository', {
      domainName: domain.attrName,
      domainOwner: this.account,
      repositoryName: artifactConfig.repositoryName,
      description: 'First-party @stevenclarke/* packages and npm upstream',
      upstreams: [artifactConfig.upstreamRepositoryName],
    });
    sharedRepository.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    sharedRepository.addDependency(upstreamRepository);

    const domainArn = this.formatArn({
      service: 'codeartifact',
      resource: 'domain',
      resourceName: artifactConfig.domainName,
    });
    const sharedRepositoryArn = this.formatArn({
      service: 'codeartifact',
      resource: 'repository',
      resourceName: `${artifactConfig.domainName}/${artifactConfig.repositoryName}`,
    });
    const upstreamRepositoryArn = this.formatArn({
      service: 'codeartifact',
      resource: 'repository',
      resourceName: `${artifactConfig.domainName}/${artifactConfig.upstreamRepositoryName}`,
    });

    this.artifacts = {
      domainName: artifactConfig.domainName,
      domainOwner: this.account,
      domainArn,
      repositoryName: artifactConfig.repositoryName,
      sharedRepositoryArn,
      upstreamRepositoryArn,
      repositoryArns: [sharedRepositoryArn, upstreamRepositoryArn],
      packageArnPattern: this.formatArn({
        service: 'codeartifact',
        resource: 'package',
        resourceName: `${artifactConfig.domainName}/${artifactConfig.repositoryName}/npm/${artifactConfig.npmScope.replace(/^@/, '')}/*`,
      }),
      npmRegistryUrl: `https://${artifactConfig.domainName}-${this.account}.d.codeartifact.${this.region}.amazonaws.com/npm/${artifactConfig.repositoryName}/`,
      npmScope: artifactConfig.npmScope,
      region: artifactConfig.region,
    };

    new ssm.StringParameter(this, 'DomainParameter', {
      parameterName: '/platform/artifacts/codeartifact/domain',
      stringValue: this.artifacts.domainName,
      description: 'Shared CodeArtifact domain name',
    });
    new ssm.StringParameter(this, 'DomainOwnerParameter', {
      parameterName: '/platform/artifacts/codeartifact/domain-owner',
      stringValue: this.artifacts.domainOwner,
      description: 'AWS account ID that owns the shared CodeArtifact domain',
    });
    new ssm.StringParameter(this, 'RegionParameter', {
      parameterName: '/platform/artifacts/codeartifact/region',
      stringValue: this.artifacts.region,
      description: 'Region of the shared CodeArtifact domain',
    });
    new ssm.StringParameter(this, 'RepositoryParameter', {
      parameterName: '/platform/artifacts/codeartifact/repository',
      stringValue: this.artifacts.repositoryName,
      description: 'Shared CodeArtifact publish repository',
    });
    new ssm.StringParameter(this, 'NpmRegistryUrlParameter', {
      parameterName: '/platform/artifacts/codeartifact/npm-registry-url',
      stringValue: this.artifacts.npmRegistryUrl,
      description: 'npm registry URL for @stevenclarke/* packages',
    });
    new ssm.StringParameter(this, 'NpmScopeParameter', {
      parameterName: '/platform/artifacts/codeartifact/npm-scope',
      stringValue: this.artifacts.npmScope,
      description: 'npm scope reserved for first-party packages',
    });
  }
}

export function grantArtifactRead(principal: iam.Role, artifacts: ArtifactResources): void {
  principal.addToPolicy(new iam.PolicyStatement({
    sid: 'CodeArtifactDomainRead',
    effect: iam.Effect.ALLOW,
    actions: [
      'codeartifact:DescribeDomain',
      'codeartifact:GetAuthorizationToken',
      'codeartifact:ListRepositoriesInDomain',
    ],
    resources: [artifacts.domainArn],
  }));

  principal.addToPolicy(new iam.PolicyStatement({
    sid: 'CodeArtifactRepositoryRead',
    effect: iam.Effect.ALLOW,
    actions: [
      'codeartifact:GetRepositoryEndpoint',
      'codeartifact:ReadFromRepository',
    ],
    resources: artifacts.repositoryArns,
  }));

  principal.addToPolicy(new iam.PolicyStatement({
    sid: 'CodeArtifactBearerToken',
    effect: iam.Effect.ALLOW,
    actions: ['sts:GetServiceBearerToken'],
    resources: ['*'],
    conditions: {
      StringEquals: {
        'sts:AWSServiceName': 'codeartifact.amazonaws.com',
      },
    },
  }));
}

export function grantArtifactPublish(principal: iam.Role, artifacts: ArtifactResources): void {
  principal.addToPolicy(new iam.PolicyStatement({
    sid: 'CodeArtifactPublish',
    effect: iam.Effect.ALLOW,
    actions: [
      'codeartifact:PublishPackageVersion',
      'codeartifact:PutPackageMetadata',
    ],
    resources: [artifacts.packageArnPattern],
  }));
}

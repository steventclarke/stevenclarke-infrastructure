import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cfOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

// CloudFront origin-facing managed prefix list for us-east-2. Ingress to the
// origin is restricted to this list so only CloudFront can reach GoatCounter.
const CLOUDFRONT_PREFIX_LIST_US_EAST_2 = 'pl-b6a144df';

const ANALYTICS_HOSTNAME = 'analytics.stevenclarke.dev';
const ANALYTICS_ADMIN_EMAIL = 'steven.t.clarke@gmail.com';
const ANALYTICS_REGION = 'us-east-2';

const GOATCOUNTER_VERSION = 'v2.7.0';
const GOATCOUNTER_URL = `https://github.com/arp242/goatcounter/releases/download/${GOATCOUNTER_VERSION}/goatcounter-${GOATCOUNTER_VERSION}-linux-arm64.gz`;

const LITESTREAM_VERSION = '0.5.18';
const LITESTREAM_URL = `https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-arm64.tar.gz`;

// GoatCounter data path on the retained data volume. The SQLite database lives
// here and is replicated to S3 by Litestream.
const DATA_ROOT = '/opt/goatcounter';
const DATA_DIR = `${DATA_ROOT}/goatcounter-data`;
const DB_PATH = `${DATA_DIR}/db.sqlite3`;

// GoatCounter's built-in GeoIP database is country-only; region data is
// recorded only when a City-level .mmdb is loaded. DB-IP Lite is a free
// (CC BY 4.0) City database published monthly.
const GEOIP_DIR = `${DATA_ROOT}/geoip`;
const GEOIP_DB_PATH = `${GEOIP_DIR}/dbip-city-lite.mmdb`;
const DBIP_CITY_LITE_BASE_URL = 'https://download.db-ip.com/free/dbip-city-lite';

const BACKUP_OBJECT_PREFIX = 'goatcounter/db';

export class AnalyticsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Read the platform contract from SSM at deploy time so synth does not
    // depend on cached CDK context or AWS credentials.
    const hostedZoneId = ssm.StringParameter.valueForStringParameter(this, '/platform/dns/hosted-zone-id');
    const domainName = ssm.StringParameter.valueForStringParameter(this, '/platform/dns/domain-name');
    const certArn = ssm.StringParameter.valueForStringParameter(this, '/platform/certs/us-east-1/wildcard-arn');
    const vpcId = ssm.StringParameter.valueForStringParameter(this, '/platform/network/vpc-id');
    const publicSubnetId = ssm.StringParameter.valueForStringParameter(this, '/platform/network/public-subnet-1-id');
    const publicSubnetAz = ssm.StringParameter.valueForStringParameter(this, '/platform/network/public-subnet-1-az');
    const alertsTopicArn = ssm.StringParameter.valueForStringParameter(this, '/platform/monitoring/alerts-topic-arn');

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'PlatformVpc', {
      vpcId,
      availabilityZones: [publicSubnetAz],
      publicSubnetIds: [publicSubnetId],
    });

    // Ingress restricted to the CloudFront origin-facing prefix list only; no
    // direct public access to the application port.
    const originSecurityGroup = new ec2.SecurityGroup(this, 'OriginSecurityGroup', {
      vpc,
      description: 'Allow only CloudFront origin-facing traffic to GoatCounter',
      allowAllOutbound: true,
    });
    originSecurityGroup.connections.allowFrom(
      ec2.Peer.prefixList(CLOUDFRONT_PREFIX_LIST_US_EAST_2),
      ec2.Port.tcp(8080),
      'CloudFront origin-facing managed prefix list'
    );

    // Private, versioned, retained backup bucket. RETAIN keeps the bucket (and
    // its Litestream replicas) in place if the stack is destroyed, so analytics
    // data survives a teardown of the EC2 instance.
    const backupBucket = new s3.Bucket(this, 'BackupBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Random admin password generated at deploy time and stored in Secrets
    // Manager. The instance reads it at first boot; it is never placed in the
    // launch template or user data.
    const adminSecret = new secretsmanager.Secret(this, 'AdminSecret', {
      description: 'GoatCounter dashboard admin password',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 24,
      },
    });

    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'GoatCounter instance role: SSM, secrets, and S3 backup access',
    });
    instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    adminSecret.grantRead(instanceRole);
    backupBucket.grantReadWrite(instanceRole, `${BACKUP_OBJECT_PREFIX}/*`);

    // User data installs GoatCounter and Litestream, creates the admin user on
    // first boot, restores from S3 if a replica already exists, and registers
    // both services with systemd.
    const userData = ec2.UserData.custom(
      cdk.Fn.sub(this.buildUserData(), {
        SecretId: adminSecret.secretArn,
        Bucket: backupBucket.bucketName,
      })
    );

    const instanceProfile = new iam.CfnInstanceProfile(this, 'InstanceProfile', {
      roles: [instanceRole.roleName],
    });

    const image = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
    }).getImage(this);

    // Drive the instance from a Launch Template. Updating the `UserData` of an
    // EBS-rooted AWS::EC2::Instance only *restarts* it, and cloud-init runs
    // user-data once per instance, so a redeploy would silently skip bootstrap
    // changes. Changing a Launch Template requires instance replacement, so the
    // corrected user-data always runs on a fresh boot.
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        imageId: image.imageId,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO).toString(),
        userData: cdk.Fn.base64(userData.render()),
        iamInstanceProfile: { arn: instanceProfile.attrArn },
        metadataOptions: { httpEndpoint: 'enabled', httpTokens: 'required' },
        // Retain the root volume on termination/destroy so the SQLite data is
        // not lost when the instance is torn down. Litestream is the second copy.
        blockDeviceMappings: [
          {
            deviceName: '/dev/xvda',
            ebs: {
              encrypted: true,
              volumeSize: 8,
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              deleteOnTermination: false,
            },
          },
        ],
        networkInterfaces: [
          {
            deviceIndex: 0,
            associatePublicIpAddress: false,
            groups: [originSecurityGroup.securityGroupId],
            subnetId: publicSubnetId,
          },
        ],
      },
    });

    const instance = new ec2.CfnInstance(this, 'Instance', {
      launchTemplate: {
        launchTemplateId: launchTemplate.ref,
        version: launchTemplate.attrLatestVersionNumber,
      },
    });

    // A stable Elastic IP so the CloudFront origin domain does not change on
    // instance replacement.
    const elasticIp = new ec2.CfnEIP(this, 'ElasticIp', { domain: 'vpc' });
    new ec2.CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.ref,
    });

    // CloudFront needs a hostname, not a bare IP, for the origin domain. Build
    // the reverse-DNS name of the Elastic IP at deploy time.
    const originDomain = cdk.Fn.join('.', [
      cdk.Fn.sub('ec2-${Dashes}', {
        Dashes: cdk.Fn.join('-', cdk.Fn.split('.', elasticIp.ref)),
      }),
      ANALYTICS_REGION,
      'compute.amazonaws.com',
    ]);

    const origin = new cfOrigins.HttpOrigin(originDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 8080,
      connectionAttempts: 3,
      connectionTimeout: cdk.Duration.seconds(10),
    });

    const trackerCachePolicy = new cloudfront.CachePolicy(this, 'TrackerCachePolicy', {
      comment: 'Short cache for the GoatCounter tracking script',
      defaultTtl: cdk.Duration.minutes(5),
      minTtl: cdk.Duration.minutes(1),
      maxTtl: cdk.Duration.hours(1),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [ANALYTICS_HOSTNAME],
      certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', certArn),
      defaultBehavior: {
        origin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        '/count.js': {
          origin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: trackerCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: domainName,
    });
    const aliasTarget = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'AnalyticsARecord', { zone: hostedZone, recordName: 'analytics', target: aliasTarget });
    new route53.AaaaRecord(this, 'AnalyticsAaaaRecord', { zone: hostedZone, recordName: 'analytics', target: aliasTarget });

    // Publish the analytics contract (Phase 9) through SSM.
    new ssm.StringParameter(this, 'ProviderParam', {
      parameterName: '/platform/analytics/provider',
      stringValue: 'GoatCounter',
      description: 'Selected analytics product',
    });
    new ssm.StringParameter(this, 'DomainParam', {
      parameterName: '/platform/analytics/domain',
      stringValue: ANALYTICS_HOSTNAME,
      description: 'Analytics hostname',
    });
    new ssm.StringParameter(this, 'ScriptUrlParam', {
      parameterName: '/platform/analytics/script-url',
      stringValue: `https://${ANALYTICS_HOSTNAME}/count.js`,
      description: 'GoatCounter tracking script URL for tenant apps',
    });
    new ssm.StringParameter(this, 'DashboardUrlParam', {
      parameterName: '/platform/analytics/dashboard-url',
      stringValue: `https://${ANALYTICS_HOSTNAME}/`,
      description: 'GoatCounter dashboard URL',
    });

    // Instance health alarm wired to the platform alert topic.
    const alertTopic = sns.Topic.fromTopicArn(this, 'AlertTopic', alertsTopicArn);
    const statusCheckAlarm = new cloudwatch.Alarm(this, 'InstanceStatusCheckAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { InstanceId: instance.ref },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Statistic.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'GoatCounter analytics instance failed EC2 status checks',
    });
    statusCheckAlarm.addAlarmAction(new cwActions.SnsAction(alertTopic));

    this.addNagSuppressions(
      backupBucket,
      originSecurityGroup,
      instanceRole,
      adminSecret,
      instance,
      distribution
    );

    new cdk.CfnOutput(this, 'DashboardUrl', { value: `https://${ANALYTICS_HOSTNAME}/` });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'BackupBucketName', { value: backupBucket.bucketName });
  }

  private buildUserData(): string {
    return `#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

# GoatCounter (single static arm64 binary)
curl -fsSL -o /tmp/goatcounter.gz "${GOATCOUNTER_URL}"
gunzip -f /tmp/goatcounter.gz
install -m 0755 /tmp/goatcounter /usr/local/bin/goatcounter

# Litestream (continuous SQLite -> S3 replication)
curl -fsSL -o /tmp/litestream.tar.gz "${LITESTREAM_URL}"
tar -xzf /tmp/litestream.tar.gz -C /tmp litestream
install -m 0755 /tmp/litestream /usr/local/bin/litestream

# Dedicated service user and data directory
id -u goatcounter >/dev/null 2>&1 || useradd --system --home-dir ${DATA_ROOT} --shell /usr/sbin/nologin goatcounter
mkdir -p ${DATA_DIR}
chown -R goatcounter:goatcounter ${DATA_ROOT}

# Admin password from Secrets Manager (never in this script)
ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id \${SecretId} --query SecretString --output text --region ${ANALYTICS_REGION})

# Litestream config must exist before any restore attempt; writing it after
# the restore makes the restore command abort first boot (the config is
# required even when no replica exists yet).
cat > /etc/litestream.yml <<'EOF'
dbs:
  - path: ${DB_PATH}
    replicas:
      - type: s3
        bucket: \${Bucket}
        path: ${BACKUP_OBJECT_PREFIX}
        region: ${ANALYTICS_REGION}
    snapshot-interval: 6h
EOF

# Restore from Litestream if a replica already exists, otherwise create the
# initial site and admin user.
if [ ! -f ${DB_PATH} ]; then
  litestream restore -if-replica-exists -config /etc/litestream.yml ${DB_PATH}
fi
if [ ! -f ${DB_PATH} ]; then
  goatcounter db create site \\
    -createdb \\
    -db "sqlite+${DB_PATH}" \\
    -vhost=${ANALYTICS_HOSTNAME} \\
    -user.email=${ANALYTICS_ADMIN_EMAIL} \\
    -password="$ADMIN_PASSWORD"
fi
chown -R goatcounter:goatcounter ${DATA_ROOT}

# City-level GeoIP database for region collection. Downloads are best-effort so
# a failure falls back to the built-in country database instead of breaking
# boot. A monthly timer refreshes the database (DB-IP Lite is published monthly).
cat > /usr/local/bin/goatcounter-geoip-update <<'EOF'
#!/bin/bash
set -euo pipefail
dst="${GEOIP_DB_PATH}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for offset in 0 1 2; do
  month=$(date -u -d "$offset month ago" +%Y-%m)
  url="${DBIP_CITY_LITE_BASE_URL}-$month.mmdb.gz"
  if curl -fsSL --max-time 300 -o "$tmp/db.gz" "$url"; then
    if gunzip -c "$tmp/db.gz" > "$tmp/db.mmdb" 2>/dev/null && [ -s "$tmp/db.mmdb" ]; then
      install -d -o goatcounter -g goatcounter "$(dirname "$dst")"
      if [ -f "$dst" ] && cmp -s "$tmp/db.mmdb" "$dst"; then
        echo "GeoIP database already current ($month)"
        exit 0
      fi
      install -m 0644 -o goatcounter -g goatcounter "$tmp/db.mmdb" "$dst"
      echo "Updated GeoIP database from $url"
      if systemctl is-active --quiet goatcounter.service; then
        systemctl restart goatcounter.service
      fi
      exit 0
    fi
  fi
done
echo "WARNING: could not download DB-IP City Lite; keeping current/built-in database" >&2
EOF
chmod 0755 /usr/local/bin/goatcounter-geoip-update
/usr/local/bin/goatcounter-geoip-update || true

# Only pass -geodb when a City database is present, so a failed download still
# leaves GoatCounter running with the built-in country database.
GEO_ARG=""
if [ -f "${GEOIP_DB_PATH}" ]; then
  GEO_ARG="-geodb ${GEOIP_DB_PATH}"
fi

# GoatCounter service
cat > /etc/systemd/system/goatcounter.service <<EOF
[Unit]
Description=GoatCounter analytics (:8080)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=goatcounter
Group=goatcounter
WorkingDirectory=${DATA_ROOT}
ExecStart=/usr/local/bin/goatcounter serve -listen=:8080 -tls=proxy -automigrate $GEO_ARG -db sqlite+${DB_PATH}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Litestream service
cat > /etc/systemd/system/litestream.service <<'EOF'
[Unit]
Description=Litestream replication for GoatCounter SQLite
After=goatcounter.service
Wants=network-online.target

[Service]
Type=simple
User=goatcounter
Group=goatcounter
ExecStart=/usr/local/bin/litestream replicate -config /etc/litestream.yml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Monthly GeoIP refresh (DB-IP Lite is published monthly)
cat > /etc/systemd/system/goatcounter-geoip-update.service <<'EOF'
[Unit]
Description=Refresh the DB-IP City Lite GeoIP database for GoatCounter
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/goatcounter-geoip-update
EOF

cat > /etc/systemd/system/goatcounter-geoip-update.timer <<'EOF'
[Unit]
Description=Monthly refresh of the DB-IP City Lite GeoIP database

[Timer]
OnCalendar=*-*-02 04:17:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now goatcounter.service
systemctl enable --now litestream.service
systemctl enable --now goatcounter-geoip-update.timer
`;
  }

  private addNagSuppressions(
    backupBucket: s3.Bucket,
    originSecurityGroup: ec2.SecurityGroup,
    instanceRole: iam.Role,
    adminSecret: secretsmanager.Secret,
    instance: ec2.CfnInstance,
    distribution: cloudfront.Distribution
  ): void {
    NagSuppressions.addResourceSuppressions(backupBucket, [
      { id: 'AwsSolutions-S2', reason: 'Server access logging omitted to minimize cost; Litestream replicas are the backup path' },
      { id: 'AwsSolutions-S1', reason: 'Analytics data is small and versioned; lifecycle cleanup deferred' },
    ]);
    NagSuppressions.addResourceSuppressions(originSecurityGroup, [
      { id: 'AwsSolutions-EC23', reason: 'Instance requires outbound internet for SSM, S3, and Secrets Manager without NAT/VPC endpoints' },
    ]);
    NagSuppressions.addResourceSuppressions(instanceRole, [
      { id: 'AwsSolutions-IAM4', reason: 'AmazonSSMManagedInstanceCore is the standard SSM Session Manager policy' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `${this.stackName}/InstanceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Litestream S3 access is scoped to the private backup bucket prefix; wildcard verbs come from the S3 grant API',
        },
      ]
    );
    NagSuppressions.addResourceSuppressions(adminSecret, [
      { id: 'AwsSolutions-SMG4', reason: 'Password is a long-lived dashboard credential; the value is set in GoatCounter on first boot and rotation would not propagate' },
    ]);
    NagSuppressions.addResourceSuppressions(instance, [
      { id: 'AwsSolutions-EC28', reason: 'Detailed monitoring adds cost; a status-check alarm already covers instance health' },
      { id: 'AwsSolutions-EC29', reason: 'Single low-criticality instance by design; not part of an ASG' },
    ]);
    NagSuppressions.addResourceSuppressions(distribution, [
      { id: 'AwsSolutions-CFR1', reason: 'PRICE_CLASS_100 already limits edge coverage; Geo restrictions are unnecessary for a portfolio analytics host' },
      { id: 'AwsSolutions-CFR2', reason: 'WAF is deferred per Phase 9; origin is private behind CloudFront with a restricted security group' },
      { id: 'AwsSolutions-CFR3', reason: 'Access logging omitted to minimize cost; dashboard authentication protects access' },
      { id: 'AwsSolutions-CFR5', reason: 'Origin protocol is deliberately HTTP on :8080; the origin is only reachable through CloudFront and the origin-facing prefix list' },
    ]);
  }
}

# Platform Infrastructure Implementation Plan

Source: [spec.md](./spec.md)

## 1. Objective

Create a centralized infrastructure repository that owns the shared AWS platform for
`stevenclarke.dev`, while each application repository deploys and manages its own
application infrastructure independently.

The platform repository owns:

- The `stevenclarke.dev` DNS zone and GoDaddy nameserver delegation.
- Shared TLS certificates.
- The shared VPC and any shared database capability.
- GitHub Actions OIDC trust and IAM deployment roles for this repository and each
  application repository.
- Developer access roles, platform monitoring, and budget alerts.
- The CI/CD pipeline that deploys platform changes from `main`.
- A cross-tool SSM parameter contract and application onboarding documentation.

Application repositories own their application compute, storage, queues, secrets, and
other app-specific resources. They also create their own subdomain records in the
shared Route 53 zone.

## 2. Decision Log

| Area | Decision |
| --- | --- |
| AWS account | Use the new, currently empty AWS account. It is not part of an AWS Organization and does not use Control Tower. |
| Environments | `preview` and `prod` are tenants in the same AWS account. Resources are named and tagged per environment. |
| Primary region | `us-east-2`. CloudFront certificates are created in `us-east-1` as required by AWS. |
| Budget | Target is under `$10/month` for AWS. Enforce with an AWS Budget and alerts. |
| Human access | The repository manages a dedicated `DeveloperRole`. A single human sign-in is bootstrapped manually and assumes that role. |
| Domain | Keep registration at GoDaddy and delegate DNS to Route 53 nameservers. |
| Existing DNS | Only default GoDaddy records exist; none need to be preserved. |
| DNS ownership | Platform owns the hosted zone; applications create their own records with scoped IAM access. |
| Apex | `stevenclarke.dev` serves the portfolio site. No `www` redirect is required. |
| Root domains | Support only `stevenclarke.dev` for now. |
| Portfolio hosting | Static S3 + CloudFront. |
| Iron Altar hosting | Static frontend. |
| Squat Monster hosting | Static frontend plus a backend server on EC2. |
| Media Inspector hosting | Static frontend. |
| Shared platform resources | VPC and database capability are platform-owned. Queues and other app-specific resources are application-owned. |
| API subdomain | Support deeper names such as `api.squat-monster.stevenclarke.dev` and its preview equivalent. |
| IaC | This repository uses AWS CDK with TypeScript. Applications standardize on CDK; Terraform consumers are supported through SSM. |
| Reusability | Publish shared platform resources and documentation/examples only, not reusable CDK constructs or Terraform modules. |
| Stack structure | Use multiple focused stacks: DNS, certificates, OIDC/roles, network, data, parameters, and monitoring. |
| GitHub | Repositories are public under `github.com/steventclarke`: `stevenclarke-infrastructure`, `portfolio`, `iron-altar`, `squat-monster`, and `media-inspector`. |
| Branches | `preview` auto-deploys to the preview environment. `main` deploys to production with manual approval. |
| Platform repo branches | Shared platform resources deploy only from `main` with approval. The `preview` branch validates and runs `cdk diff`; it does not publish shared platform changes. |
| Repository settings | Branch protection and GitHub Environments are configured manually by the owner. |
| Deploy roles | Least-privilege per-app, per-environment roles from day one, with documented exceptions where CDK bootstrap requires broader access. |
| Rollback | CloudFormation rollback only. Operational issues are handled through GitHub issues and follow-up changes. |
| WAF | Application-managed. |
| Alerting | Email via SNS for now; Slack may be added later. |
| Compliance | No specific compliance or data-residency requirements. |
| Public access | S3 buckets and APIs are private by default and exposed only through CloudFront or explicitly scoped security groups. |
| Secrets | Application-owned by default. A shared secrets store may be added later if needed. |

## 3. Architecture

### 3.1 AWS foundation

- Primary platform region: `us-east-2`.
- CDK bootstrap both `us-east-2` (platform and application resources) and `us-east-1`
  (CloudFront certificates).
- Environment naming: `<app>-preview` and `<app>-prod`, with matching tags
  `environment=preview|prod`.
- All resources tagged with `project`, `environment`, `owner`, `application`, and
  `managed-by`.
- AWS Budget of `$10/month` with alerts at 50%, 80%, and 100% of forecasted and actual
  spend.
- Baseline CloudTrail and cost-allocation tags where they do not add material cost.

Cost guardrails for the `$10/month` target:

- No NAT Gateway.
- No Application Load Balancer at launch.
- No always-on RDS instance at launch.
- Prefer S3 + CloudFront, a single small EC2 instance, and serverless or on-demand
  services where feasible.
- Revisit these constraints if the budget is increased.

### 3.2 DNS and hostnames

- Create a public Route 53 hosted zone for `stevenclarke.dev`.
- Update GoDaddy custom nameservers to the Route 53 NS records. No existing records
  need migration.
- Platform owns the hosted zone and the apex record.
- Each application repository creates its own records using the hosted zone ID from
  SSM and a scoped `route53:ChangeResourceRecordSets` permission.
- Hostname scheme:

| Deployment | Hostname |
| --- | --- |
| Portfolio production | `stevenclarke.dev` |
| Portfolio preview | `portfolio-preview.stevenclarke.dev` |
| Iron Altar production | `iron-altar.stevenclarke.dev` |
| Iron Altar preview | `iron-altar-preview.stevenclarke.dev` |
| Squat Monster production | `squat-monster.stevenclarke.dev` |
| Squat Monster preview | `squat-monster-preview.stevenclarke.dev` |
| Squat Monster API production | `api.squat-monster.stevenclarke.dev` |
| Squat Monster API preview | `api-preview.squat-monster.stevenclarke.dev` |
| Media Inspector production | `media-inspector.stevenclarke.dev` |
| Media Inspector preview | `media-inspector-preview.stevenclarke.dev` |

### 3.3 Shared certificates

- Issue `stevenclarke.dev` plus `*.stevenclarke.dev` in `us-east-1` for CloudFront.
- Issue `*.squat-monster.stevenclarke.dev` in `us-east-1` for the Squat Monster API
  and preview API hostnames.
- Issue regional certificates in `us-east-2` only if an application uses a regional
  endpoint such as an ALB or API Gateway directly.
- DNS-validate all certificates against the platform hosted zone.
- Publish certificate ARNs through SSM.
- SSM is regional, so mirror the `us-east-1` certificate ARNs into `us-east-2` using a
  CDK custom resource or a post-deploy workflow step. Applications read the contract
  from their deployment region.

### 3.4 Shared network

- Platform creates a shared VPC in `us-east-2`.
- Start with a cost-optimized design that avoids NAT Gateway charges.
- Static applications use private S3 buckets plus CloudFront Origin Access Control and
  need no VPC.
- Squat Monster's EC2 backend uses the shared VPC and is restricted to CloudFront
  traffic through security groups or a CloudFront VPC origin where supported.
- Publish the VPC ID and applicable subnet IDs to SSM.
- If private-subnet egress becomes necessary, add VPC endpoints or a NAT instance only
  after validating the budget impact.

### 3.5 Shared data

- The platform owns any shared database.
- Defer provisioning until the first application has a concrete requirement and the
  engine can be costed within the budget.
- Do not provision always-on RDS at launch. Candidate engines include DynamoDB
  on-demand or a database hosted on the Squat Monster EC2 instance.
- Application-owned queues and app-specific data stores remain in the application
  repositories.

### 3.6 GitHub OIDC and IAM roles

- Create the GitHub OIDC identity provider in AWS.
- Trust policies use exact repository and branch subjects, for example
  `repo:steventclarke/iron-altar:ref:refs/heads/preview`.
- No wildcard repository trust. No long-lived AWS access keys in GitHub.
- Role matrix:

| Role | Trusted repository | Trusted branch | Purpose |
| --- | --- | --- | --- |
| `platform-deploy-prod` | `stevenclarke-infrastructure` | `main` | Deploy shared platform stacks |
| `platform-preview-validate` | `stevenclarke-infrastructure` | `preview` | Synth and diff only, no shared-resource deploy |
| `portfolio-deploy-preview` | `portfolio` | `preview` | Deploy portfolio preview |
| `portfolio-deploy-prod` | `portfolio` | `main` | Deploy portfolio production |
| `iron-altar-deploy-preview` | `iron-altar` | `preview` | Deploy Iron Altar preview |
| `iron-altar-deploy-prod` | `iron-altar` | `main` | Deploy Iron Altar production |
| `squat-monster-deploy-preview` | `squat-monster` | `preview` | Deploy Squat Monster preview |
| `squat-monster-deploy-prod` | `squat-monster` | `main` | Deploy Squat Monster production |
| `media-inspector-deploy-preview` | `media-inspector` | `preview` | Deploy Media Inspector preview |
| `media-inspector-deploy-prod` | `media-inspector` | `main` | Deploy Media Inspector production |

- App roles receive only the permissions needed for their CDK stacks, plus scoped
  Route 53 record changes in the shared hosted zone.
- Where CDK bootstrap role chaining is required, document the bootstrap qualifier and
  add explicit `sts:AssumeRole` permissions rather than granting broad account admin.
- The `DeveloperRole` is defined in CDK and grants the owner console access for
  troubleshooting. Human sign-in is bootstrapped once manually with MFA; the repository
  stores no human credentials.

### 3.7 Cross-tool contract

Publish shared values as SSM Parameters:

| Parameter | Purpose |
| --- | --- |
| `/platform/dns/hosted-zone-id` | Shared Route 53 zone ID |
| `/platform/dns/domain-name` | `stevenclarke.dev` |
| `/platform/certs/us-east-1/wildcard-arn` | Wildcard CloudFront certificate ARN |
| `/platform/certs/us-east-1/squat-monster-wildcard-arn` | Squat Monster API certificate ARN |
| `/platform/certs/us-east-2/<name>-arn` | Regional certificate ARNs, if any |
| `/platform/network/vpc-id` | Shared VPC ID |
| `/platform/network/subnet-ids` | Subnet IDs available to applications |
| `/platform/monitoring/alerts-topic-arn` | SNS topic for platform alerts |
| `/platform/roles/<app>/<environment>/deploy-role-arn` | App GitHub Actions role ARN |
| `/platform/region` | Primary region (`us-east-2`) |

SSM is preferred over CloudFormation exports because Terraform consumers cannot read
CloudFormation exports directly. Keys are treated as a versioned contract and documented
in the application onboarding guide.

### 3.8 Repository layout

```text
.
├── bin/app.ts
├── lib/
│   ├── dns-stack.ts
│   ├── certificate-stack.ts
│   ├── github-oidc-stack.ts
│   ├── deploy-roles-stack.ts
│   ├── developer-role-stack.ts
│   ├── network-stack.ts
│   ├── data-stack.ts
│   ├── parameters-stack.ts
│   └── monitoring-stack.ts
├── config/
│   ├── environments.ts
│   └── applications.ts
├── test/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── docs/
│   └── onboarding-an-application.md
├── cdk.json
├── package.json
└── README.md
```

Application onboarding is configuration-driven: adding an application means adding an
entry to `config/applications.ts` with its repository name, hostnames, environment
roles, and certificate requirements, then deploying the platform stacks.

### 3.9 CI/CD flows

**This repository**

- Pull requests: install, lint, type-check, unit/snapshot tests, `cdk synth`,
  `cdk-nag`, and `cdk diff`.
- Merge to `preview`: run the same validation and `cdk diff`; do not deploy shared
  platform resources.
- Merge to `main`: authenticate via GitHub OIDC, run the same checks, require manual
  approval through the `production` GitHub Environment, then deploy.
- Use concurrency controls to prevent overlapping deployments.
- Deploy order: DNS, certificates, OIDC/roles, network/data, parameters, monitoring.
  Certificates must validate before dependent resources are created.

**Application repositories**

- Merge to `preview`: auto-deploy the preview tenant using the preview role.
- Merge to `main`: deploy production after manual approval through the `production`
  GitHub Environment.
- Application pipelines read shared values from SSM, create their own DNS records, and
  deploy only their own resources.
- This repository is not involved in application deployments.

## 4. Implementation Phases

### Phase 0: Repository and prerequisite setup

- Create the public GitHub repository and configure manual branch protection and GitHub
  Environments (`preview`, `production`).
- Confirm local AWS admin credentials for bootstrap.
- Create the AWS Budget and cost alerts early.
- Record the GitHub repository and branch naming convention.

### Phase 1: AWS and CDK bootstrap

- Bootstrap CDK in `us-east-2` and `us-east-1`.
- Initialize the CDK TypeScript project with linting, tests, and `cdk-nag`.
- Add environment configuration, naming, and tagging.
- Define the `DeveloperRole` and bootstrap the human sign-in path.
- Verify `cdk synth`, `cdk diff`, and a no-op deployment.

### Phase 2: DNS foundation

- Create the Route 53 hosted zone.
- Export the NS records and update GoDaddy nameservers.
- Verify public resolution.
- Publish the zone ID and domain name to SSM.
- Create the apex record after the portfolio CloudFront distribution is available.

### Phase 3: Shared certificates

- Create the wildcard/apex certificate in `us-east-1`.
- Create the Squat Monster wildcard certificate in `us-east-1`.
- Validate both via DNS.
- Mirror certificate ARNs into `us-east-2` SSM.
- Document the regional certificate pattern for direct regional endpoints.

### Phase 4: GitHub OIDC and IAM roles

- Create the GitHub OIDC provider.
- Create platform and per-application roles for `preview` and `prod`.
- Scope each role to its repository, branch, required services, and shared-zone DNS
  record changes.
- Publish role ARNs to SSM.
- Test assumability from each repository's workflow.

### Phase 5: Shared network and data

- Create the cost-optimized shared VPC in `us-east-2`.
- Publish VPC and subnet IDs to SSM.
- Defer the shared database until the first concrete requirement is confirmed.
- Validate that the network design does not introduce NAT or ALB charges.

### Phase 6: Platform CI/CD and monitoring

- Implement PR validation and preview-branch workflows.
- Implement the `main` deployment workflow with OIDC, approval, and concurrency.
- Create the SNS alert topic with the owner's email subscription.
- Add budget and platform health alarms.
- Verify an end-to-end platform deployment.

### Phase 7: Onboard applications

- Write the application onboarding guide with CDK and Terraform examples.
- Onboard the portfolio site first as the pilot.
- Validate independent deployment, DNS record creation, certificate use, and preview
  and production branches.
- Onboard Iron Altar, Squat Monster, and Media Inspector.
- Validate the Squat Monster API hostname and shared VPC access.
- Confirm the Terraform consumption path with a representative workflow.

### Phase 8: Hardening and operations

- Review IAM permissions and remove unnecessary grants.
- Document rollback, DNS cutover, certificate renewal, and OIDC troubleshooting.
- Add a process for onboarding future applications.
- Revisit the budget and shared database decision once real usage is known.

## 5. Deliverables

- CDK application with DNS, certificate, OIDC, role, network, data, parameter, and
  monitoring stacks.
- GitHub Actions workflows for validation and deployment.
- Application onboarding documentation, including CDK and Terraform examples.
- SSM parameter contract for shared platform values.
- Tests, snapshot tests, and `cdk-nag` policy checks in CI.
- Operational runbook and rollback procedure.
- All four applications deployed to their production hostnames, with preview
  deployments available from the `preview` branch.

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `$10/month` budget is exceeded by EC2, CloudFront, or a shared database | Enforce budget alerts; avoid NAT, ALB, and always-on RDS; review costs before each phase; delete unused preview resources. |
| GoDaddy nameserver cutover disrupts resolution | Record current defaults, update nameservers, verify NS propagation, and keep the change reversible. |
| CloudFront certificates created in the wrong region | Standardize on `us-east-1` for CloudFront and use `us-east-2` only for regional endpoints. |
| SSM parameters are region-scoped | Mirror certificate and platform parameters into `us-east-2` and document which region applications read. |
| Public GitHub repositories and OIDC trust | Use exact `repo:...:ref:refs/heads/...` subjects and never wildcard repository names. |
| Preview and prod resources collide in one account | Use `<app>-<environment>` naming, tags, separate stacks, and environment-scoped IAM roles. |
| App IAM roles are too broad | Scope permissions by service and resource; document CDK bootstrap exceptions; review before onboarding each app. |
| Shared database cost or engine choice delays onboarding | Defer provisioning until a concrete requirement exists and validate cost first. |
| Terraform interoperability drift | Treat SSM keys as a versioned contract and document all required keys and consumers. |
| Accidental production deployment | GitHub Environment approval, branch protection, concurrency locks, and branch-scoped OIDC roles. |
| CDK state or drift issues | Use focused stacks, CI `cdk diff`, and CloudFormation rollback; document manual recovery. |

## 7. Open Items

These do not block Phase 1 but must be resolved before the relevant phase:

1. **Shared database engine and size**: confirm the engine and monthly cost before
   Phase 5. Options include DynamoDB on-demand or a database hosted on the Squat
   Monster EC2 instance.
2. **Squat Monster API ingress**: confirm whether `api.squat-monster.stevenclarke.dev`
   is fronted by CloudFront or exposed directly through a regional endpoint. This
   determines whether the API certificate is needed in `us-east-1`, `us-east-2`, or
   both.
3. **EC2 sizing**: select the instance type and purchasing option that keeps the total
   AWS spend under `$10/month`.
4. **Preview resource lifecycle**: decide whether preview resources are destroyed after
   a period of inactivity to control cost.
5. **Human sign-in method**: choose IAM Identity Center or a manually bootstrapped IAM
   user with MFA for assuming `DeveloperRole`.

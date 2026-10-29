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
| Environments | `preview` and `prod` are tenants in the same AWS account. Resources are named and tagged per environment. This applies to tenant applications only. |
| Platform repo environments | `stevenclarke-infrastructure` has a single deployment target: global to the account, affecting the entire stack. There is no `preview`/`prod` split for the platform itself. |
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
| Squat Monster hosting | Static frontend plus a backend service on ECS. |
| Media Inspector hosting | Static frontend. |
| Shared platform resources | VPC and database capability are platform-owned. Queues and other app-specific resources are application-owned. |
| API subdomain | Apps with API components use `<app>-api.stevenclarke.dev` (prod) and `<app>-api-preview.stevenclarke.dev` (preview) to remain covered by the top-level wildcard `*.stevenclarke.dev`. |
| IaC | This repository uses AWS CDK with TypeScript. Applications standardize on CDK; Terraform consumers are supported through SSM. |
| Reusability | Publish shared platform resources and documentation/examples only, not reusable CDK constructs or Terraform modules. |
| Stack structure | Use multiple focused stacks: DNS, certificates, OIDC/roles, network, data, parameters, and monitoring. |
| GitHub | Repositories are public under `github.com/steventclarke`: `stevenclarke-infrastructure`, `portfolio`, `iron-altar`, `squat-monster`, and `media-inspector`. |
| Branches | Tenant applications: `preview` auto-deploys to the preview environment; `main` deploys to production with manual approval. |
| Platform repo branches | `stevenclarke-infrastructure` deploys only from `main` with approval. There is no `preview` branch in this repository; CI/CD is driven entirely by merge to `main`. |
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
- Use ALB only if necessary for ECS, but prefer cost-optimized patterns.
- No always-on RDS instance at launch; prefer DynamoDB on-demand or a cost-optimized managed service.
- Prefer S3 + CloudFront, ECS with small container tasks, and serverless or on-demand
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
| Squat Monster API production | `squat-monster-api.stevenclarke.dev` |
| Squat Monster API preview | `squat-monster-api-preview.stevenclarke.dev` |
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
- Squat Monster's ECS backend uses the shared VPC and is restricted to CloudFront
  traffic through security groups or a CloudFront VPC origin where supported.
- Publish the VPC ID and applicable subnet IDs to SSM.
- If private-subnet egress becomes necessary, add VPC endpoints or a NAT instance only
  after validating the budget impact.

### 3.5 Shared data

- The platform owns any shared database.
- Defer provisioning until the first application has a concrete requirement and the
  engine can be costed within the budget.
- Do not provision always-on RDS at launch. Candidate engines include DynamoDB
  on-demand or a containerized workload or managed service.
- Application-owned queues and app-specific data stores remain in the application
  repositories.

### 3.6 GitHub OIDC and IAM roles

- Create the GitHub OIDC identity provider in AWS.
- Trust policies use exact repository and branch subjects, for example
  `repo:steventclarke/iron-altar:ref:refs/heads/preview`.
- GitHub now includes a generated numeric ID in the OIDC `sub` claim, so subjects use the
  form `repo:steventclarke@<org-id>/<repo>@<repo-id>:...`. The exact subject must be
  copied from GitHub (or the failed workflow's CloudTrail event) into the trust policy.
  App roles are configured with their generated repo IDs in `lib/oidc-stack.ts`.
- The platform deploy role uses an environment subject instead of a branch subject,
  because its workflow runs in the `production` GitHub Environment:
  `repo:steventclarke@3586962/stevenclarke-infrastructure@1431511755:environment:production`.
- No wildcard repository trust. No long-lived AWS access keys in GitHub.
- Role matrix:

| Role | Trusted repository | Trusted subject | Purpose |
| --- | --- | --- | --- |
| `platform-deploy-prod` | `stevenclarke-infrastructure` | `environment:production` | Deploy shared platform stacks |
| `portfolio-deploy-preview` | `portfolio` | `ref:refs/heads/preview` | Deploy portfolio preview |
| `portfolio-deploy-prod` | `portfolio` | `ref:refs/heads/main` | Deploy portfolio production |
| `iron-altar-deploy-preview` | `iron-altar` | `ref:refs/heads/preview` | Deploy Iron Altar preview |
| `iron-altar-deploy-prod` | `iron-altar` | `ref:refs/heads/main` | Deploy Iron Altar production |
| `squat-monster-deploy-preview` | `squat-monster` | `ref:refs/heads/preview` | Deploy Squat Monster preview |
| `squat-monster-deploy-prod` | `squat-monster` | `ref:refs/heads/main` | Deploy Squat Monster production |
| `media-inspector-deploy-preview` | `media-inspector` | `ref:refs/heads/preview` | Deferred (no repository yet) |
| `media-inspector-deploy-prod` | `media-inspector` | `ref:refs/heads/main` | Deferred (no repository yet) |

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
| `/platform/certs/us-east-1/squat-monster-wildcard-arn` | DEPRECATED (covered by top-level wildcard `*.stevenclarke.dev`) |
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
- Merge to `main`: authenticate via GitHub OIDC, run the same checks, require manual
  approval through the `production` GitHub Environment, then deploy.
- There is no `preview` branch or preview environment for the platform itself; the
  platform is a single global deployment target for the account.
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



### 3.10 Preview deployment from workstation (tenant applications)

The platform repository itself has no preview environment. For tenant applications,
developers can deploy to preview without merging to branches:

- **Environment selection**: CDK apps accept `-c environment=preview|prod`. Default to `preview` for safety when deploying from workstation.
- **Tagging**: All resources tagged with `Environment=preview|prod` via `Tags.of(app).add()`.
- **Stack naming**: Stacks named as `<Environment>-<StackName>` (e.g., `preview-NetworkStack`).
- **IAM roles**:
  - `DeveloperPreviewRole`: Assumable by developers via SSO, with permissions scoped to resources tagged `Environment=preview`. Denies access to `Environment=prod` resources.
  - `platform-deploy-prod`: Used only by CI/CD for prod deployments from `main` branch. No direct human access.
- **Resource isolation**: IAM policies use ABAC with `aws:ResourceTag/Environment` conditions where supported. Explicit denies for prod-tagged resources.
- **Usage**: `export AWS_PROFILE=dev-preview` (or assume role) then `cdk deploy -c environment=preview --all`

## 4. Implementation Phases

### Phase 0: Repository and prerequisite setup (Completed)

- [x] Create the public GitHub repository ([steventclarke/stevenclarke-infrastructure](https://github.com/steventclarke/stevenclarke-infrastructure))
- [x] Configure branch protection manually (PRs required for `main` and `preview`; `main` requires approval via `production` environment)
- [x] Create GitHub Environments `preview` and `production` (configured manually)
- [x] Confirm local AWS admin credentials for bootstrap via IAM Identity Center SSO (profile `admin`, `AWS_PROFILE=admin` in `~/.zshrc`)
- [x] Record the GitHub repository and branch naming convention
  - Repos under `github.com/steventclarke/`
  - `main`: production release candidates; deploys to production with manual approval
  - `preview`: integration branch; auto-deploys to preview environment
  - `phase/<n>` or `phase/<n>-<description>`: phase branches (e.g., `phase/0`, `phase/1-aws-and-cdk-bootstrap`)
  - `[issue-number]-[description]` - branch for issues where branch name is issue number followed by brief description, separate words with dashes


### Phase 1: AWS and CDK bootstrap (Completed)

- [x] Bootstrap CDK in `us-east-2` and `us-east-1`.
- [x] Initialize the CDK TypeScript project with linting, tests, and `cdk-nag`.
- [x] Add environment configuration, naming, and tagging.
- [x] Create the AWS Budget and cost alerts early (CDK `MonitoringStack`; confirm SNS email subscription after deploy)
- [x] Define the `DeveloperRole` and bootstrap the human sign-in path.
- [x] Verify `cdk synth`, `cdk diff`, and a no-op deployment.

### Phase 2: DNS foundation (Completed)

- [x] Create the Route 53 hosted zone for `stevenclarke.dev` (DnsStack in `lib/dns-stack.ts`)
- [x] Export the NS records (CfnOutput `NameServers`)
- [x] Update GoDaddy nameservers (GoDaddy updated; verified via `dig NS stevenclarke.dev +short`)
- [x] Verify public resolution
- [x] Publish the zone ID and domain name to SSM Parameter Store (`/platform/dns/hosted-zone-id`, `/platform/dns/domain-name`)
- [deferred] Create the apex record (`stevenclarke.dev`) pointing to the portfolio CloudFront distribution (deferred to Phase 7; requires portfolio distribution to exist)

### Phase 3: Shared certificates (Completed)

- [x] Create the wildcard/apex certificate in `us-east-1`.
- [x] Create the Squat Monster wildcard certificate in `us-east-1`.
- [x] Validate both via DNS.
- [x] Mirror certificate ARNs into `us-east-2` SSM.
- [x] Document the regional certificate pattern for direct regional endpoints (see docs/regional-certificate-pattern.md).

### Phase 4: GitHub OIDC and IAM roles (Completed)

- [x] Create the GitHub OIDC provider (via CDK in `OidcStack`).
- [x] Create platform and per-application roles for `preview` and `prod` (exact repo/branch trust, no wildcard repo trust).
- [x] Scope each role to its repository, branch, required services, and shared-zone DNS record changes (basic scoping; further refinement as apps onboard).
- [x] Publish role ARNs to SSM (`/platform/roles/.../deploy-role-arn`).
- [x] Decide human sign-in method for DeveloperRole (IAM Identity Center vs manually bootstrapped IAM user with MFA) and document/bootstrap as needed (Open item #5). **Decision:** Use IAM Identity Center SSO with profile `admin` (AdminAccess permission set) for administration; developers use a permission set that allows assuming the `DeveloperRole`. See Appendix for setup.

### Phase 5: Shared network and data (Completed)

- [x] Create the cost-optimized shared VPC in `us-east-2` (no NAT Gateway).
- [x] Publish VPC and subnet IDs to SSM (`/platform/network/vpc-id`, `/platform/network/subnet-ids`).
- [x] Confirm shared database engine and size (DynamoDB on-demand) and monthly cost estimate before provisioning (Open item #1 resolved).
- [x] Defer the shared database until the first concrete requirement is confirmed.
- [x] Validate that the network design does not introduce NAT or ALB charges.

### Phase 6: Platform CI/CD and monitoring (Completed)

- [x] Refactor the existing implementation to remove the `preview`/`prod` split for this infrastructure repository itself (single global deployment target), while preserving `preview`/`prod` support for tenant applications.
- [x] Implement PR validation workflows.
- [x] Implement the `main` deployment workflow with OIDC, approval, and concurrency.
- [x] Test assumability from stevenclarke-infrastructures repository's workflow using the deployed OIDC roles.
- [x] Decide preview resource lifecycle (destroy after inactivity vs keep) and implement as needed (Open item #4). **Decision:** Manual cleanup with tagging/alerts; runbook cleanup procedure added.
- [x] Create the SNS alert topic with the owner's email subscription.
- [x] Add budget alerts (50/80/100% actual + forecasted).
- [deferred] Add platform health alarms (deferred until dynamic resources such as CloudFront/ECS exist).
- [x] Verify an end-to-end platform deployment.

### Phase 7: Onboard applications

- [x] Write the application onboarding guide with CDK and Terraform examples (see docs/onboarding-an-application.md).
- [ ] Onboard the portfolio site first as the pilot.
- [ ] Create the apex record (`stevenclarke.dev`) in Route 53 pointing to the portfolio CloudFront distribution (platform-owned).
- [ ] Validate independent deployment, DNS record creation, certificate use, and preview
  and production branches.
- [ ] Verify DeveloperRole has read-only access to preview and prod resources via AWS CLI.
- [ ] Verify DeveloperRole has read-only access to preview and prod resources via AWS Console.
- [x] Confirm Squat Monster API ingress (direct regional endpoint in us-east-2 via ALB/API Gateway; cost priority). With the new naming convention, API hostnames are covered by the top-level wildcard `*.stevenclarke.dev`; regional ACM certificate may be needed in `us-east-2` only if the endpoint requires a region-specific cert per service constraints (documented in docs/regional-certificate-pattern.md). (Open item #2 resolved.)
- [ ] Select ECS task size and compute options (prefer Fargate Spot) for Squat Monster to stay under $10/month (Open item #3).
- [ ] Onboard Iron Altar, Squat Monster, and Media Inspector.
- [ ] Validate the Squat Monster API hostname and shared VPC access.
- [ ] Confirm the Terraform consumption path with a representative workflow.

### Phase 8: Hardening and operations

- [ ] Add platform health alarms
- [ ] Review IAM permissions and remove unnecessary grants.
- [ ] Document rollback, DNS cutover, certificate renewal, and OIDC troubleshooting.
- [ ] Add a process for onboarding future applications.
- [ ] Revisit the budget and shared database decision once real usage is known.

## 5. Deliverables

- [ ] CDK application with DNS, certificate, OIDC, role, network, data, parameter, and
  monitoring stacks.
- [ ] GitHub Actions workflows for validation and deployment.
- [ ] Application onboarding documentation, including CDK and Terraform examples.
- [ ] SSM parameter contract for shared platform values.
- [ ] Tests, snapshot tests, and `cdk-nag` policy checks in CI.
- [ ] Operational runbook and rollback procedure.
- [ ] All four applications deployed to their production hostnames, with preview
  deployments available from the `preview` branch.

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `$10/month` budget is exceeded by ECS, CloudFront, or a shared database | Enforce budget alerts; avoid NAT, ALB, and always-on RDS; review costs before each phase; delete unused preview resources. |
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


## Appendix: AWS IAM Identity Center (SSO) Admin Login

This project uses AWS IAM Identity Center for authentication. Configure once, then log in as needed.

### Initial configuration
1. Enable IAM Identity Center in the AWS Console in `us-east-2`.
2. Create a user in the built-in directory and assign it the `AdministratorAccess` permission set for the account.
3. Copy the AWS Access Portal URL.
4. Run:
```bash
aws configure sso --profile admin
```
   When prompted, provide the portal URL, set SSO region to `us-east-2`, authenticate in the browser, select the account and `AdministratorAccess`, set default region to `us-east-2`, and profile name to `admin`.
5. Add to `~/.zshrc`:
```bash
export AWS_PROFILE=admin
```
   Then `source ~/.zshrc`.

### Daily usage
```bash
aws sso login --profile admin
aws sts get-caller-identity
```

If credentials are missing, run `aws sso login --profile admin`. Tokens expire periodically. `~/.aws/config` must include `sso_account_id` and `sso_role_name` for the profile.

## 7. Open Items

These do not block Phase 1 but must be resolved before the relevant phase:

1. [x] **Shared database engine and size**: DynamoDB on-demand (pay per request, no idle cost). Design shared database as DynamoDB on-demand; defer provisioning until first concrete requirement.
2. [x] **Squat Monster API ingress**: direct regional endpoint in `us-east-2` (ALB/API Gateway) for cost. API hostname follows `<app>-api.stevenclarke.dev` / `<app>-api-preview.stevenclarke.dev` and is covered by the top-level wildcard `*.stevenclarke.dev` in `us-east-1`. A regional certificate in `us-east-2` is only needed if the regional endpoint requires it per AWS constraints.
3. [ ] **ECS sizing**: select ECS task size and compute options (prefer Fargate Spot) that keep total AWS spend under `$10/month`.
4. [x] **Preview resource lifecycle**: decide whether preview resources are destroyed after a period of inactivity to control cost. **Decision:** Manual cleanup by the owner/developer (no automated TTL yet). Rely on environment tagging (`environment=preview|prod`), AWS Budget alerts (50/80/100%), and documented cleanup procedures. Re-evaluate and automate (time-based/PR-based) if spend alerts indicate previews are accumulating cost.
5. [x] **Human sign-in method**: choose IAM Identity Center or a manually bootstrapped IAM user with MFA for assuming `DeveloperRole`. **Decision:** Use IAM Identity Center SSO with profile `admin` (AdminAccess permission set). Developers use an IAM Identity Center permission set that allows assuming the `DeveloperRole`. Setup documented in README and plan Appendix.
## CI/CD setup notes (Phase 6)
- Configure GitHub Environment: `production` (required reviewers). No `preview` environment is needed for this repository.
- Set repository variable: `PLATFORM_DEPLOY_ROLE_ARN` (from SSM `/platform/roles/...`).
- Branch protection: require PR reviews for `main`.
- Manual deployment: `deploy-manual.yml` is a `workflow_dispatch` workflow that deploys the platform stacks. It runs `cdk diff` first, then deploys only when the `confirm` input is set to `deploy`. It uses the `production` environment (required reviewers) and the `platform-deploy-prod` role, so it must be triggered from `main` (the role's OIDC trust is scoped to `ref:refs/heads/main`).

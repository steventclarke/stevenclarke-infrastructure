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
- Self-hosted, open-source website analytics for the portfolio and tenant applications
  (GoatCounter; see Phase 9).
- Shared end-user identity: a Cognito User Pool with Google as an identity provider, one
  platform-owned Google OAuth client, and a published SSM contract for tenant apps
  (Phase 10).
- A global, platform-owned artifact repository for publishing and consuming internal
  libraries (Phase 11).

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
| Apex | `stevenclarke.dev` (apex) aliases to the portfolio's production CloudFront distribution. The distribution 301-redirects apex traffic (including paths and query strings) to `portfolio.stevenclarke.dev`. |
| Root domains | Support only `stevenclarke.dev` for now. |
| Portfolio hosting | Static S3 + CloudFront. |
| Iron Altar hosting | Static frontend. |
| Squat Monster hosting | Static frontend plus a backend service on ECS. |
| Media Inspector hosting | Static frontend. |
| Shared platform resources | VPC and database capability are platform-owned. Queues and other app-specific resources are application-owned. |
| API subdomain | Apps with API components use `<app>-api.stevenclarke.dev` (prod) and `<app>-api-preview.stevenclarke.dev` (preview) to remain covered by the top-level wildcard `*.stevenclarke.dev`. |
| IaC | This repository uses AWS CDK with TypeScript. Applications standardize on CDK; Terraform consumers are supported through SSM. |
| Reusability | Publish shared platform resources and documentation/examples only, not reusable CDK constructs or Terraform modules. |
| Stack structure | Use multiple focused stacks: DNS, certificates, OIDC/roles, network, data, parameters, monitoring, and analytics (planned). |
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
| Website analytics | Self-hosted, open-source, privacy-friendly analytics for the portfolio and tenant apps. Platform-owned. **Chosen:** GoatCounter on a single EC2 `t4g.nano` behind CloudFront (Phase 9). |
| Analytics hostname | `analytics.stevenclarke.dev`, served through CloudFront with the shared wildcard certificate. |
| Analytics budget | The existing `$10/month` target holds. GoatCounter on `t4g.nano` is the budget-first option (~`$4–7`/month incremental); no budget increase required. |
| Analytics teardown & durability | Analytics is a standalone `AnalyticsStack`; `cdk destroy AnalyticsStack` removes only analytics resources. Collected data survives via a retained (`deleteOnTermination: false`) data volume and Litestream replication to a retained, versioned, private S3 bucket. |
| End-user authentication | Tenant apps use a platform-owned Cognito User Pool with Google as a federated IdP ("Sign in with Google"). This is end-user login, distinct from IAM Identity Center admin SSO and GitHub Actions OIDC. |
| User pool scope | One user pool shared by all tenant apps and both `preview`/`prod` environments. The shared user directory gives SSO across apps; no per-app or per-environment pool isolation at launch. |
| Google OAuth client | One Google Cloud OAuth client owned by the platform. Its only registered redirect URI is the Cognito Hosted UI `/oauth2/idpresponse` endpoint. The client secret lives in a platform-owned Secrets Manager secret, never in app repos or git. |
| Cognito domain | Cognito-provided domain (`<prefix>.auth.us-east-2.amazoncognito.com`) at launch: no extra ACM certificate or Route 53 record. Apps read the domain from SSM so a later custom domain (`auth.stevenclarke.dev`) is transparent. |
| Per-app OAuth clients | Application-owned. Each tenant app defines its own `UserPoolClient` (callback/logout URLs, scopes, token lifetimes) in its own IaC. The platform grants scoped `cognito-idp` client-management permissions to app deploy roles and publishes the pool ID/ARN via SSM. |
| OAuth client type | Public clients using authorization code + PKCE (`generateSecret: false`). No client secret is distributed to apps or browsers. |
| Artifact repository | Use AWS CodeArtifact in `us-east-2`, platform-owned. One domain `stevenclarke` with a customer-managed KMS key. A single internal repository `shared` holds first-party packages; format-specific upstream repositories cache public registries. |
| Artifact formats | Start with npm packages under the `@stevenclarke/*` scope. Add PyPI, Maven, NuGet, Cargo, or generic-format support only when a real consumer needs it; each public registry gets its own upstream repository because CodeArtifact allows one external connection per repository. |
| Artifact repository scope | One global repository, not per-app or per-`preview`/`prod`. Package names and immutable versions isolate consumers. This clarifies the earlier "Reusability" decision: platform documentation/examples remain the pattern for CDK/Terraform, but versioned internal libraries may be published here. |
| Artifact access | `DeveloperRole` may publish and consume. Tenant app deploy roles get read access by default; publish access is opt-in per application in `config/applications.ts`. Authentication uses short-lived CodeArtifact tokens (max 12 hours), never long-lived npm tokens. |
| Artifact durability | Retain the domain, repositories, and KMS key on stack deletion. CodeArtifact packages are immutable; never republish a version. Do not add automated cleanup. |

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
| Portfolio production | `portfolio.stevenclarke.dev` |
| Portfolio apex | `stevenclarke.dev` (aliases to the portfolio production distribution, which 301-redirects to `portfolio.stevenclarke.dev`) |
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
| `/platform/analytics/domain` | Analytics hostname (`analytics.stevenclarke.dev`) |
| `/platform/analytics/provider` | Selected analytics product (`GoatCounter`) |
| `/platform/analytics/script-url` | Tracking script URL for tenant apps (`https://analytics.stevenclarke.dev/count.js`) |
| `/platform/analytics/dashboard-url` | Dashboard URL (`https://analytics.stevenclarke.dev/`) |
| `/platform/analytics/<app>/<environment>/site-id` | Per-app, per-environment analytics site identifier (published when each app is onboarded) |
| `/platform/analytics/<app>/<environment>/enabled` | Whether the site is tracked (published when each app is onboarded) |
| `/platform/auth/user-pool-id` | Shared Cognito User Pool ID (import the pool and create app clients) |
| `/platform/auth/user-pool-arn` | Shared user pool ARN (IAM scoping and Cognito authorizers) |
| `/platform/auth/domain` | Cognito Hosted UI domain, e.g. `stevenclarke.auth.us-east-2.amazoncognito.com` |
| `/platform/auth/issuer` | OIDC issuer URL (`https://cognito-idp.us-east-2.amazonaws.com/<pool-id>`) |
| `/platform/auth/jwks-uri` | JWKS endpoint for verifying ID and access tokens |
| `/platform/artifacts/codeartifact/domain` | CodeArtifact domain name (`stevenclarke`) |
| `/platform/artifacts/codeartifact/domain-owner` | AWS account ID that owns the CodeArtifact domain |
| `/platform/artifacts/codeartifact/region` | CodeArtifact region (`us-east-2`) |
| `/platform/artifacts/codeartifact/repository` | Internal repository name (`shared`) |
| `/platform/artifacts/codeartifact/npm-registry-url` | npm registry URL for `@stevenclarke/*` packages |
| `/platform/artifacts/codeartifact/npm-scope` | npm scope for first-party packages (`@stevenclarke`) |

Application-published values (written by app repos, read by the platform):

| Parameter | Purpose |
| --- | --- |
| `/app/portfolio/prod/cloudfront-domain` | Portfolio production CloudFront distribution domain name (used by `ApexRecordStack`) |

The portfolio now publishes `/app/portfolio/prod/cloudfront-domain`. `ApexRecordStack`
consumes it (plus `/platform/dns/hosted-zone-id` and `/platform/dns/domain-name`) as
deploy-time SSM-backed CloudFormation parameters, so the platform deploy does not depend
on cached CDK context or the portfolio stack being part of this app.

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
│   ├── apex-record-stack.ts
│   ├── github-oidc-stack.ts
│   ├── deploy-roles-stack.ts
│   ├── developer-role-stack.ts
│   ├── network-stack.ts
│   ├── data-stack.ts
│   ├── parameters-stack.ts
│   ├── analytics-stack.ts      # GoatCounter analytics (Phase 9)
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

### 3.11 Website analytics

**Statement of intent:** self-host an open-source website analytics solution to monitor
the portfolio website and the tenant applications hosted on this platform, keeping
visitor data in this AWS account and avoiding third-party tracking.

**Planned scope**

- Platform-owned analytics deployed from this repository as part of the CDK app.
- Multi-site tracking for the portfolio, Iron Altar, Squat Monster, and Media Inspector,
  with separate site identifiers per application and environment.
- A single analytics hostname, proposed as `analytics.stevenclarke.dev`, for both the
  dashboard and the tracking endpoint.
- Tenant applications add the tracking snippet themselves and read the endpoint and
  site identifier from SSM. This repository does not inject snippets into tenant apps.
- Preview traffic is tracked separately from production, or excluded, so production
  reports are not polluted.

**Requirements**

- Privacy-friendly defaults: no cookies or personal data where the chosen tool allows,
  no cross-site tracking, and no consent banner for ordinary use unless the selected
  tool requires one.
- Lightweight, asynchronous tracking script that fails open: an analytics outage must
  not block page rendering or application behaviour.
- SPA-safe pageview tracking, custom events/goals, referrers, pages, devices, browsers,
  approximate countries, and campaign tracking.
- Dashboard authentication and a documented access model (single owner account at
  launch; per-application users only if needed).
- Data ownership: export path, backups, restore procedure, and a documented retention
  period.
- Fits the existing `$10/month` budget target, or the budget is explicitly increased
  before implementation. No NAT Gateway and no ALB unless a cost case is made.
- TLS through the shared wildcard certificate in `us-east-1`, with CloudFront in front
  of the origin. No inbound SSH; administration through SSM Session Manager.
- Encrypted storage, least-privilege instance/task role, secrets in SSM SecureString,
  and CloudWatch alarms wired to the existing SNS topic.
- Analytics is a platform-global resource, not a tenant application. It serves both
  `preview` and `prod` tenant environments from one deployment.

**Proposed architecture at a high level**

| Layer | Proposed approach |
| --- | --- |
| DNS | `analytics.stevenclarke.dev` in the existing Route 53 zone |
| Edge | CloudFront distribution using `/platform/certs/us-east-1/wildcard-arn`; cache the static tracker, disable caching for dashboard and tracking API paths |
| Compute | One always-on `t4g.nano` EC2 instance in the shared VPC running GoatCounter (selected; see Phase 9) |
| Data | Local persistent volume on the compute target for the lightest options; managed database only if the selected tool and budget justify it |
| Backups | EBS snapshots plus application-native dumps (SQLite copy/Litestream, PostgreSQL dump, or ClickHouse backup) to a private S3 bucket |
| Secrets | SSM SecureString for application secret and database credentials |
| Observability | CloudWatch alarms for instance/task health, disk, and backup failures, published to the existing SNS alert topic |
| Access | Dashboard login; SSM Session Manager for host administration; no inbound SSH |

The detailed technology matrix, hosting options, cost scenarios, and decision worksheet
are in Phase 9.

### 3.12 End-user authentication (Google SSO)

Tenant apps need "Sign in with Google" without each app building its own identity system.
The platform provides one shared Cognito User Pool with Google as a federated identity
provider; tenant apps own their own OAuth clients and sign-in UX. The full tenant-facing
integration guide is
[docs/google-sso-for-tenant-apps.md](./docs/google-sso-for-tenant-apps.md).

| Concern | Owner |
| --- | --- |
| Google Cloud OAuth client, consent screen, client secret | Platform (manual setup + Secrets Manager) |
| Cognito User Pool, Google IdP, Hosted UI domain | Platform (`AuthStack`) |
| `/platform/auth/*` SSM contract | Platform |
| Scoped `cognito-idp` client-management permission on app deploy roles | Platform (`OidcStack`) |
| Per-app `UserPoolClient` (callbacks, logout URLs, scopes, token lifetimes) | **Application** |
| Sign-in UI, callback/logout routes, session handling, token validation, CSP | **Application** |

Sign-in flow:

1. The app redirects the user to the shared Cognito `/oauth2/authorize` endpoint with its
   own client ID, callback URL, and PKCE challenge.
2. Cognito redirects to Google; the user signs in with a Google account. Google's only
   registered redirect URI is the Cognito Hosted UI `/oauth2/idpresponse` endpoint.
3. Cognito creates or updates the federated user in the shared pool and redirects to the
   app's callback URL with an authorization code.
4. The app exchanges the code (with its PKCE verifier) for tokens and validates them
   against the shared issuer/JWKS with its own client ID as the audience.

Because all clients live in one pool, the Cognito Hosted UI session provides SSO across
apps and environments. Apps never handle the Google client secret; a misconfigured app
client can only affect its own callback URLs.

Constraints: public clients with PKCE only (no distributed secret), Cognito MFA off
(Google enforces its own), the Standard (free) Cognito feature tier to protect the
`$10/month` budget, and SSM-sourced domain/issuer values so a future custom domain needs
no app changes.

### 3.13 Global artifact repository

Applications need one shared place to publish and consume internal libraries without
per-app registries or long-lived registry tokens. The platform owns an AWS CodeArtifact
domain and repository in `us-east-2`; the tenant-facing guide is in
`docs/artifact-repository.md`.

| Concern | Owner |
| --- | --- |
| CodeArtifact domain, KMS key, repositories, domain/repository policies | Platform (`ArtifactsStack`) |
| Public-registry upstream connections and caching | Platform (`ArtifactsStack`) |
| `/platform/artifacts/*` SSM contract | Platform |
| Read/publish IAM permissions for app deploy roles | Platform (`OidcStack`, opt-in per app for publish) |
| Local `aws codeartifact login` and CI token refresh | Developer / application CI |
| Package naming, semver, and publishing | Application/library owner |

Layout:

```text
CodeArtifact domain: stevenclarke (customer-managed KMS key, retained)
├── repository: npmjs (external connection: public:npmjs)
└── repository: shared (upstream: npmjs)
    └── first-party packages: @stevenclarke/*
```

The `shared` repository is the only publish target. Public packages are cached on demand
through upstream repositories; no packages are copied at deploy time. Additional formats
get additional upstream repositories (for example `pypi` → `public:pypi`) and are added to
`shared` as upstreams only when needed. Cross-account domain/repository policies are not
in the initial scope because all tenant applications are in the same account; the
customer-managed KMS key avoids a later key migration.

Consumers and publishers read the domain, owner account, repository, region, and npm
registry URL from SSM. Each CI job exchanges the caller's AWS credentials for a
short-lived CodeArtifact token; tokens are never cached or committed. Locally, the SSO
profile is used with `aws codeartifact login --tool npm --namespace @stevenclarke` so the
default npm registry configuration is not overwritten.

Package versions are immutable. Internal consumers should pin exact versions or a
controlled range rather than depend on `latest`. Deleting the stack retains the domain,
repositories, and KMS key because CodeArtifact requires empty repositories before domain
deletion and package loss would break downstream builds.

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
- [x] Fix app deploy role permissions: separate the Route 53 conditional statement from the other actions (the `route53:HostedZoneArn` condition was breaking non-Route 53 actions such as SSM).
- [x] Onboard the portfolio site first as the pilot.
- [x] Create the apex record (`stevenclarke.dev`) in Route 53 aliasing to the portfolio production CloudFront distribution (platform-owned `ApexRecordStack`; A and AAAA alias records; reads the zone and distribution domain from `/platform/dns/hosted-zone-id`, `/platform/dns/domain-name`, and `/app/portfolio/prod/cloudfront-domain` at deploy time — the portfolio handoff is now published).
- [x] Validate independent deployment, DNS record creation, certificate use, and preview
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

### Phase 9: Self-hosted website analytics (In progress — deployed, first-boot fix)

**Goal:** self-host an open-source analytics solution for the portfolio and tenant
applications, keeping analytics data in this AWS account and avoiding third-party
tracking.

**Status:** Technology selected (GoatCounter on a single EC2 `t4g.nano`) and the
`AnalyticsStack` implemented in `lib/analytics-stack.ts` and wired into `bin/app.ts`.
The stack is deployed (`UPDATE_COMPLETE`) with DNS, CloudFront, the Elastic IP, and the
origin security group verified. First deployment surfaced a first-boot ordering bug
(user data ran `litestream restore` before writing `/etc/litestream.yml`, so the script
aborted and neither service started); the fix reorders the config write ahead of the
restore. A second deploy showed that updating `UserData` on an EBS-rooted
`AWS::EC2::Instance` only *restarts* it, and cloud-init runs user-data once per instance,
so the corrected bootstrap never executed (CloudFront still returned 504). The instance is
now driven by a Launch Template, whose changes require replacement, so bootstrap changes
always run on a fresh boot. A third deploy confirmed the replacement and reordered
bootstrap run, but the script still aborted: `goatcounter db create site` refuses to run
when the SQLite database does not exist, and Litestream had no replica to restore yet.
The site bootstrap now passes `-createdb`. A fourth deploy surfaced the GeoIP download
silently failing: the updater staged the ~60 MB archive and ~130 MB decompressed
database in `/tmp`, which is a ~210 MB tmpfs on the nano instance, so extraction hit
ENOSPC and GoatCounter fell back to the country-only database (Regions stayed disabled).
The updater now stages next to the destination on the root filesystem, and GoatCounter
runs through a wrapper that adds `-geodb` at every start so a later successful refresh
enables regions without a redeploy. Remaining work is redeploy, tenant onboarding, and
operational validation (see 9.9).

#### 9.1 Scope and requirements

- [x] Capture the analytics statement of intent and requirements in this plan.
- [x] Select the analytics technology (Open item #6). **Decision: GoatCounter.**
- [x] Select the hosting pattern (Open item #7). **Decision: single EC2 `t4g.nano` in the shared VPC.**
- [x] Confirm whether the `$10/month` budget is fixed or increased (Open item #8). **Decision: keep `$10`; GoatCounter fits (~`$4–7`).**
- [x] Confirm the analytics hostname and edge design. **Decision: `analytics.stevenclarke.dev` behind CloudFront.**
- [x] Confirm the site model and preview-tracking policy (Open item #9). **Decision: one site per `<app>-<environment>`; preview sites are created only when a tenant opts in.**
- [x] Confirm retention, privacy notice, and backup policy (Open item #10). **Decision: cookie-free; 24-month retention target; Litestream to S3 + retained EBS.**
- [x] Confirm dashboard access model (Open item #11). **Decision: single owner account (email + password).**
- [x] Implement the analytics stack in CDK and wire it into `bin/app.ts`.
- [x] Add DNS, CloudFront, certificate, and origin security.
- [x] Add compute, persistent storage, secrets, backups, and alarms.
- [x] Drive the instance from a Launch Template so bootstrap (user-data) changes
      replace the instance instead of only restarting it.
- [x] Create the initial SQLite database and site (`goatcounter db create site
      -createdb`) during bootstrap.
- [x] Load a City-level GeoIP database (DB-IP Lite) via `-geodb` so region data
      is recorded, with a monthly refresh timer.
- [x] Publish the analytics SSM contract.
- [ ] Add tenant onboarding docs and snippet examples.
- [ ] Add the snippet to the portfolio and each tenant application.
- [ ] Validate tracking and dashboard access for production and preview.
- [ ] Update budget and monitoring.
- [ ] Mark Phase 9 completed.

Functional requirements:

- Pageviews, unique visitors, referrers, pages, entry/exit pages, devices, browsers,
  operating systems, approximate countries, and campaign/referrer attribution.
- Custom events or goals suitable for tracking sign-ups, key clicks, and form
  submissions.
- Multi-site support with one dashboard and separate site identifiers per application
  and environment.
- Real-time or near-real-time reporting; retention and export/backup path documented.
- SPA-safe tracking, and a snippet that does not block rendering if the endpoint is
  unavailable.
- Dashboard authentication. One owner account is sufficient at launch; per-application
  users are optional.
- Works with strict tenant Content Security Policy (`script-src` and `connect-src`).

Non-functional requirements:

- Privacy-friendly: cookie-free and no personal data where the selected tool allows;
  document any consent requirement.
- TLS through the shared wildcard certificate; CloudFront in front of the origin.
- No inbound SSH; use SSM Session Manager. Encrypted EBS and private S3 backups.
- Least-privilege instance/task role and SSM SecureString secrets.
- CloudWatch alarms to the existing SNS topic; backup failure alerting.
- No NAT Gateway and no ALB unless the cost case is explicitly accepted.
- Deployable from the existing platform pipeline; no new deployment path for tenants.

#### 9.2 Technology options

All costs are **incremental monthly estimates**, not total platform spend. They assume
`us-east-2`, on-demand list prices, 730 hours, and exclude existing platform costs,
taxes, and discounts. CloudFront is expected to stay within its monthly free tier at
portfolio traffic levels, but confirm with the AWS Pricing Calculator before selecting.

| Option | License | Runtime and data | Strengths | Limitations | Practical footprint | Est. incremental AWS cost | Best fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **GoatCounter** | EUPL-1.2 (modified); tracker ISC | Go single binary; SQLite by default, PostgreSQL optional | Lightest option; single binary; SQLite file is trivial to back up; multi-site; privacy-first; accessible UI; API; can import CloudFront logs; click events | Modest product analytics; no funnels, heatmaps, or session replay; simpler UI; solo-maintained project | ~0.5 GB RAM; tiny disk footprint (SQLite grows slowly) | **$4–7** on EC2 t4g.nano/micro + EBS + backups/CloudFront | Best if the `$10/month` cap is firm |
| **Umami** | MIT | Node.js/Next.js; PostgreSQL | Modern dashboard; real-time; custom events; funnels/retention in current releases; multi-site; API; 2FA; SPA support; ~2 KB tracker | Two services (app + PostgreSQL); 1 GB RAM is tight; feature set varies by release; PostgreSQL backup required | Practical 1 GB+; 10–20 GB disk | **$9–14** with PostgreSQL on the same EC2 host; **$22+** with RDS/Fargate | Best balance if ~$10–14/month is acceptable |
| **Plausible Community Edition** | AGPLv3 (CE); tracker MIT | Elixir/Phoenix + PostgreSQL + ClickHouse | Polished UX; goals and custom events; campaign attribution; lightweight tracker; strong privacy defaults | Needs 2 GB+ RAM; ClickHouse adds operational weight; CE omits funnels, ecommerce revenue goals, SSO, and the Sites API; LTS releases twice per year; AGPL | 2 GB+ RAM; 2+ cores; 10 GB+ disk | **$14–27** on EC2 t4g.small/medium + EBS | Best UX if the budget is raised and the heavier stack is acceptable |
| **Matomo** | GPLv3+ | PHP + MySQL/MariaDB + web server; archiver cron job | Deepest analytics; goals, funnels, segments, ecommerce, multi-site, granular user permissions; large plugin ecosystem; heatmaps/session recording via paid plugins | Heaviest operational burden; 2 CPU/2 GB/50 GB baseline; PHP/MySQL patching; archiver tuning; dated UI; premium plugins cost extra; cookies/consent unless configured carefully | 2 GB+ RAM; 50 GB+ disk at the recommended small-site tier | **$16–30** on EC2 t4g.small/medium + EBS | Only if deep analytics or heatmaps/session recording are required and the budget/ops cost is accepted |

Notes:

- GoatCounter comfortably fits the existing `$10/month` target. Umami fits only at the
  low end, with a co-located database on a 1 GB instance; the 2 GB configuration is
  safer but exceeds the target.
- Plausible CE and Matomo exceed the target before shared platform costs. Choosing
  either should come with an explicit budget increase.
- Confirm that the container images support `arm64` (Graviton) for the selected option.
  If an option is `amd64`-only, use an x86 instance or accept emulation overhead.
- If session replay or heatmaps are a hard requirement, Matomo (paid plugins) is the
  main option in this list; Umami session replay support should be verified against the
  release you would deploy.

**Cost scenarios**

| Scenario | Selection | Est. incremental monthly cost |
| --- | --- | --- |
| Budget-first | GoatCounter on a single EC2 `t4g.nano`/`micro` + EBS | **$4–7** |
| Balanced | Umami on a single EC2 `t4g.micro` with co-located PostgreSQL | **$9–14** |
| Polished UX | Plausible CE on EC2 `t4g.small`/`medium` + EBS | **$14–27** |
| Deep analytics | Matomo on EC2 `t4g.small` + 50 GB EBS | **$16–30** |
| Managed compute | Umami on ECS Fargate + RDS | **$22–25+** |

#### 9.3 Hosting pattern options

| Pattern | Description | Pros | Cons | Est. incremental cost |
| --- | --- | --- | --- | --- |
| **Single EC2 in the shared VPC** (recommended for GoatCounter/Umami) | One `t4g.nano`/`micro`/`small` instance in a public subnet; Docker Compose or systemd; encrypted EBS volume; CloudFront origin restricted by security group; SSM Session Manager | Cheapest; simple; persistent local SQLite/PostgreSQL; full control; no NAT or ALB | OS patching; single-AZ; manual scaling; no high availability | **$4–14** depending on instance size and tool |
| **ECS Fargate + EFS or RDS** | Fargate task behind CloudFront; SQLite on EFS or PostgreSQL on RDS | Managed compute; no OS patching; aligns with ECS direction | SQLite on EFS is not ideal for locking; RDS pushes cost over budget; always-on Fargate; more moving parts | **$9–10** with EFS (not recommended for SQLite); **$20–25** with RDS |
| **Lightsail** | Fixed-price Lightsail instance with bundled SSD and transfer; CloudFront in front | Predictable price; simple; bundled storage/transfer | Separate from the shared VPC/IAM/SSM patterns; limited CDK L2 support; less integrated with existing alarms and backups | **$5–12** |
| **Existing Squat Monster ECS cluster** | Run analytics as another service on the tenant application cluster | Reuses existing compute | Couples platform analytics to a tenant application's lifecycle and permissions; rejected | Not applicable |

Recommendation: start with a single EC2 instance and CloudFront for the lightest
options. Revisit ECS with a managed database only if analytics becomes business-critical,
needs high availability, or the budget increases.

#### 9.4 Edge, DNS, and TLS

- Proposed hostname: `analytics.stevenclarke.dev`.
- CloudFront distribution with the existing wildcard certificate from
  `/platform/certs/us-east-1/wildcard-arn`.
- Origin security group allows the CloudFront origin-facing managed prefix list only;
  no direct public access to the instance's application port.
- Cache the static tracker script; disable caching for dashboard, API, and tracking
  write paths. Forward the headers the selected tool requires.
- WAF is optional and not proposed at launch; rely on dashboard authentication,
  CloudFront, and rate/abuse controls available in the selected tool.
- Direct EC2 with a regional certificate is a simpler alternative but exposes the origin
  and gives up edge caching. CloudFront is preferred.
- A private-subnet origin would require VPC endpoints or a NAT Gateway; neither fits the
  budget target at launch. Keep the instance in a public subnet with a
  CloudFront-restricted security group.

#### 9.5 Data, backups, and retention

- Local persistent storage on EBS for the selected database.
- GoatCounter: SQLite on EBS with Litestream replication to a private S3 bucket, plus
  periodic EBS snapshots.
- Umami or Matomo: scheduled PostgreSQL/MySQL dump to S3, plus EBS snapshots.
- Plausible CE: PostgreSQL dump and ClickHouse backup to S3, plus EBS snapshots.
- S3 bucket: private, encrypted, versioned, lifecycle expiry for old backups, and a
  restore runbook.
- Test a restore before marking the phase complete.
- Proposed default retention: 24 months of raw events, with aggregates retained longer
  if the tool supports it. Confirm in Open item #10. If the tool has no automatic
  retention, add a scheduled cleanup job.

#### 9.6 Privacy and tenant integration

- Prefer cookie-free tracking. GoatCounter, Umami, and Plausible are cookie-free by
  default. Matomo must be configured carefully and may still require consent depending
  on enabled features.
- Do not store personal data intentionally. Review the tool's IP handling, geolocation,
  and retention settings.
- Update the portfolio and tenant privacy notices to mention self-hosted analytics.
- Site model: one site per `<app>-<environment>`, for example `portfolio-prod`,
  `portfolio-preview`, `iron-altar-prod`. This keeps preview traffic out of production
  reports. If preview traffic has no analytical value, disable preview sites entirely.
- Publish the analytics contract through SSM:
  `/platform/analytics/domain`, `/platform/analytics/provider`,
  `/platform/analytics/script-url`, `/platform/analytics/dashboard-url`,
  `/platform/analytics/<app>/<environment>/site-id`, and
  `/platform/analytics/<app>/<environment>/enabled`.
- Tenant applications add the asynchronous snippet themselves and update CSP to allow
  the analytics host in `script-src` and `connect-src`.
- Verify SPA navigation tracking for each framework; add manual pageview calls if the
  selected tool does not detect history changes automatically.

#### 9.7 Decision worksheet

| # | Decision | Options | Selection |
| --- | --- | --- | --- |
| 1 | Analytics technology | GoatCounter / Umami / Plausible CE / Matomo | **GoatCounter** |
| 2 | Monthly budget | Keep `$10` cap / increase to another amount | **Keep `$10` cap** |
| 3 | Hosting pattern | Single EC2 / ECS Fargate / Lightsail | **Single EC2 (`t4g.nano`)** |
| 4 | Preview tracking | Separate preview sites / exclude preview | **Separate `<app>-<environment>` sites; preview only when a tenant opts in** |
| 5 | Retention | 12 months / 24 months / indefinite | **24 months (aggregates; GoatCounter does not store a per-hit table by default)** |
| 6 | Dashboard access | Single owner account / per-application users | **Single owner account** |
| 7 | Analytics hostname | `analytics.stevenclarke.dev` / other | **`analytics.stevenclarke.dev`** |
| 8 | Edge | CloudFront / direct EC2 | **CloudFront** |
| 9 | Required features | Pageviews and referrers only / custom events and funnels / heatmaps and session replay | **Pageviews, unique visitors, referrers, campaigns, custom events (GoatCounter feature set)** |
| 10 | Backup target | S3 + EBS snapshots / S3 only / other | **Litestream to S3 + retained EBS (EBS snapshots deferred)** |

#### 9.8 Acceptance criteria

- Tracking works on the portfolio and all tenant applications in production; preview
  tracking follows the chosen policy.
- Dashboard login and multi-site reporting work; custom events/goals work if required.
- Data is stored in this AWS account, encrypted, and covered by a tested restore.
- Incremental cost stays within the approved budget; budget alerts are updated.
- No unexpected cookies or personal data; privacy notices are updated.
- CSP and SPA behavior are documented for tenant application owners.
- Alarms reach the existing SNS topic, and an operations runbook exists.

#### 9.9 Implementation design (this phase)

**Selected stack** (`lib/analytics-stack.ts`, wired into `bin/app.ts`) provisions:

| Layer | Implementation |
| --- | --- |
| DNS | `analytics.stevenclarke.dev` A + AAAA alias records to CloudFront in the existing Route 53 zone |
| Edge | CloudFront distribution using `/platform/certs/us-east-1/wildcard-arn`; `PRICE_CLASS_100`; HTTPS-only viewer policy; no-cache default behavior, short cache for `/count.js`, `ALL_VIEWER` origin request policy to forward `Host` and headers |
| Compute | `t4g.nano` (arm64) on Amazon Linux 2023, IMDSv2, in the shared VPC public subnet, launched from a Launch Template so user-data changes replace the instance; systemd-run GoatCounter `v2.7.0` on `:8080` (`-tls=proxy`) |
| Access | SSM Session Manager only (no SSH); dashboard login with a generated admin password stored in Secrets Manager |
| Data | SQLite at `/opt/goatcounter/goatcounter-data/db.sqlite3` on an encrypted gp3 root volume with `deleteOnTermination: false` |
| GeoIP | DB-IP Lite City `.mmdb` (CC BY 4.0) at `/opt/goatcounter/geoip/dbip-city-lite.mmdb`, passed via `-geodb` so GoatCounter records regions; staged on the root filesystem (not the small `/tmp` tmpfs), downloaded at boot with fallback to the prior month, refreshed monthly by a systemd timer; a serve wrapper applies `-geodb` at every start |
| Backups | Litestream `v0.5.18` continuous replication to a private, versioned S3 bucket; restore-on-first-boot if a replica exists |
| Origin security | Security group ingress restricted to the CloudFront origin-facing managed prefix list (`pl-b6a144df`); Elastic IP as the stable CloudFront origin |
| Observability | `StatusCheckFailed` alarm published to `/platform/monitoring/alerts-topic-arn` |
| Contract | Publishes `/platform/analytics/{provider,domain,script-url,dashboard-url}` |

**Supporting change:** `MonitoringStack` now publishes `/platform/monitoring/alerts-topic-arn`;
`NetworkStack` now publishes `/platform/network/public-subnet-1-id` and `-az` so the
analytics host can reference a concrete subnet without a synth-time VPC lookup.

**Teardown and data durability (required):**

- Analytics is a **separate `AnalyticsStack`**, so `cdk destroy AnalyticsStack` removes
  only the analytics resources and leaves the rest of the platform untouched.
- Collected data survives teardown through two independent copies:
  1. The root EBS volume has `DeleteOnTermination: false`, so terminating/destroying
     the instance leaves the SQLite data volume in place.
  2. The backup S3 bucket has `RemovalPolicy.RETAIN` (and versioning + encryption), so
     `cdk destroy` leaves the bucket and its Litestream replicas in place.
- Re-deploying the stack after a teardown triggers a **Litestream restore** on first
  boot (if a replica exists), so analytics data is recovered automatically. Recovering
  an orphaned EBS volume is a documented manual alternative.

**First-boot fix (post-deploy):** the initial deployment's user-data script exited
early because `litestream restore` required `/etc/litestream.yml` before that file was
written. With `set -euo pipefail` the script aborted, leaving the SQLite DB uncreated,
the systemd units absent, and nothing listening on `:8080` (CloudFront returned 504).
The fix writes `/etc/litestream.yml` before the restore attempt; a test asserts that
ordering.

**Instance replacement on bootstrap changes (post-redeploy):** the reordered user-data
was still not applied on the next deploy. Updating `UserData` on an EBS-rooted
`AWS::EC2::Instance` only restarts the instance (CloudFormation does not replace it), and
cloud-init runs the `scripts-user` module only once per instance (`freq=once-per-instance`).
The new script was written to `/var/lib/cloud/instance/` but never executed, so the host
still had no services. The instance is now created from an `AWS::EC2::LaunchTemplate`
(with the subnet on the launch-template network interface) and an `AWS::EC2::Instance`
pinned to `LatestVersionNumber`. Any launch/user-data change therefore requires
replacement and runs the corrected bootstrap on a fresh boot; the Elastic IP keeps the
CloudFront origin stable across replacements. A test asserts the instance is
Launch-Template-driven.

**Site bootstrap fix (post-redeploy):** after the replacement, user-data ran but aborted
again at `goatcounter db create site`. With no Litestream replica yet, the restore step
correctly finds nothing and leaves no database, and `db create site` refuses to run
against a missing SQLite file ("Add the -createdb flag…"). Under `set -euo pipefail` this
aborted before the systemd units were written, so nothing listened on `:8080` and
CloudFront returned 504. The command now passes `-createdb`; a test asserts the flag is
present. With the fresh instance and reordered bootstrap, this should let the site,
units, and services come up on first boot.

**GeoIP / region collection:** GoatCounter's built-in GeoIP database is country-only;
region data is recorded only when a **City** `.mmdb` is loaded via `-geodb` (the settings
page's "-geo flag" wording is outdated; the v2.7.0 flag is `-geodb`). The bootstrap
downloads the free DB-IP Lite City database (CC BY 4.0) from
`https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz` at boot, trying the
current and two prior months, and installs it at
`/opt/goatcounter/geoip/dbip-city-lite.mmdb` (owned by `goatcounter`). The archive is
staged next to the destination on the root filesystem because `/tmp` is a ~210 MB tmpfs
on the nano instance and cannot hold the ~60 MB archive plus the ~130 MB decompressed
database. GoatCounter runs through `/usr/local/bin/goatcounter-serve`, which adds
`-geodb` only when the file is readable, so a failed download falls back to the built-in
country database instead of breaking startup, and a later successful download enables
regions without a redeploy. A monthly systemd timer
(`goatcounter-geoip-update.timer`) refreshes the DB and restarts GoatCounter when it
changes. **Attribution:** DB-IP Lite requires attribution under CC BY 4.0; add
"IP geolocation by DB-IP (https://db-ip.com)" to the portfolio footer. Regions apply to
pageviews recorded after the database is loaded; older aggregates are unchanged. The
database reports `database_type = DBIP-City-Lite`, which GoatCounter accepts as a City
database (it checks that the type contains "city"), so the Regions checkbox becomes
available once the file is present and the service has restarted with `-geodb`.

**Files changed:** `lib/analytics-stack.ts` (new), `lib/network-stack.ts`,
`lib/monitoring-stack.ts`, `bin/app.ts`, `test/analytics-stack.test.ts` (new).

**Remaining steps (9.10+):**

1. Deploy the platform stack from `main` and confirm `cdk diff` shows only the new
   analytics resources.
2. Log in to `analytics.stevenclarke.dev`, retrieve the admin password from Secrets
   Manager, and validate the initial site tracks a pageview.
3. GoatCounter CLI flags were verified against the deployed binary (`db create site -createdb -vhost -user.email -password`, `serve -tls=proxy`); revisit only if the binary version changes.
4. Add the snippet and CSP guidance to the onboarding guide; onboard the portfolio,
   then create per-app `<app>-<environment>` sites and publish their `/platform/analytics/.../site-id` and `enabled` parameters.
5. Perform a restore test: destroy and redeploy the analytics stack, then confirm
   Litestream restores prior pageviews.
6. Update the privacy notices (including the DB-IP CC BY 4.0 attribution) and validate
   production + preview tracking.

### Phase 10: Google SSO for tenant apps (Platform implementation complete; deployment and tenant rollout pending)

**Goal:** let users sign in with their Google account once and access every tenant app,
without each app owning an identity provider or a Google client secret.

This PR completes the design and platform-side implementation. The one-time Google Cloud
setup, platform deployment, end-to-end pilot, and per-application integration remain
outstanding.

**Design decisions (complete)**

- [x] Capture the design, ownership split, and SSM contract in this plan (see 3.12).
- [x] Write the tenant-facing integration guide with CDK and Terraform examples
      (docs/google-sso-for-tenant-apps.md).
- [x] Decide the identity model: one shared Cognito User Pool, Google federated IdP,
      Cognito-provided domain, one platform-owned Google OAuth client.
- [x] Decide client ownership: applications own their per-app/per-environment OAuth
      clients as public clients using authorization code + PKCE.

**Platform implementation**

- [ ] Create the Google Cloud OAuth client with `amazoncognito.com` as a consent-screen
      authorized domain, the Cognito domain as an authorized JavaScript origin, and
      `https://<auth-domain>/oauth2/idpresponse` as the redirect URI; store the client ID
      in `/platform/auth/google/client-id` and the secret in `platform/google-oauth-client`
      (manual, out of band; see
      `docs/google-sso-for-tenant-apps.md#platform-prerequisites-before-deploy`).
- [x] Add `config/auth.ts` (domain prefix, pool name, Google client ID and secret
      reference).
- [x] Add `AuthStack` (`lib/auth-stack.ts`) with the user pool, Google IdP, Hosted UI
      domain, and `/platform/auth/*` SSM parameters; wire it into `bin/app.ts` before
      `OidcStack`. The Google IdP maps Google's `email_verified` claim to the Cognito
      `email_verified` attribute. The Google secret is resolved by name with
      `SecretValue.secretsManager`; a partial-ARN dynamic reference fails for names ending
      in `-<6 chars>` such as `platform/google-oauth-client`.
- [x] Add scoped `cognito-idp` client-management permissions on the shared pool ARN to
      each app deploy role in `lib/oidc-stack.ts`, passing the pool ARN via cross-stack
      reference.
- [x] Add tests (`test/auth-stack.test.ts`) and cdk-nag suppressions with documented
      reasons; `npm run build`, `npm test`, and `npm run synth` pass. `npm run diff` was
      attempted but requires AWS credentials (`Need to perform AWS calls for account
      470805152888, but no credentials have been configured`).
- [x] Update the onboarding guide and SSM contract documentation with the auth parameters
      and a link to the integration guide.
- [ ] Deploy from `main` and verify sign-in end to end with a pilot application.

**Tenant app implementation (in each application repository)**

- [ ] Add a `UserPoolClient` with the app's callback/logout URLs, scopes, and token
      lifetimes (CDK imported pool or Terraform `aws_cognito_user_pool_client`).
- [ ] Wire the OIDC redirect, callback, and logout routes and session handling; read the
      issuer, domain, and pool ID from `/platform/auth/*` SSM.
- [ ] Validate tokens (issuer, JWKS signature, audience = own client ID) in any backend or
      API, and update CSP for the Cognito domain and `accounts.google.com`.
- [ ] Verify preview and prod sign-in, then update the app's onboarding status.

### Phase 11: Global artifact repository (Completed)

**Goal:** provide one platform-owned, immutable repository where internal libraries can be
published and consumed without app-specific registries or long-lived package credentials.

**Scope**

- In scope: CodeArtifact domain with customer-managed KMS key, `npmjs` upstream repository,
  `shared` publish repository, SSM contract, IAM read/publish grants, documentation, and a
  publish/consume smoke test.
- Out of scope: cross-account access, additional package formats beyond npm, per-app
  repositories, `preview`/`prod` repository copies, and reusable CDK/Terraform constructs
  (the existing "Reusability" decision remains unchanged).

**Implementation steps**

- [x] Confirm the proposed decisions in section 2 and architecture 3.13.
- [x] Add `config/artifacts.ts` with domain `stevenclarke`, repository `shared`, npm scope
      `@stevenclarke`, upstream repository `npmjs`, and region `us-east-2`.
- [x] Add `lib/artifacts-stack.ts` with a retained customer-managed KMS key, a retained
      CodeArtifact domain, the `npmjs` repository with `public:npmjs` external connection,
      the `shared` repository with `npmjs` as upstream, standard tags, and cdk-nag
      suppressions with documented reasons.
- [x] Publish `/platform/artifacts/*` SSM values from section 3.7; wire `ArtifactsStack`
      into `bin/app.ts` before `OidcStack`.
- [x] Grant `DeveloperRole` read and publish access; grant tenant app deploy roles scoped
      read access by default and publish access only to applications opted in via
      `config/applications.ts`, including `sts:GetServiceBearerToken` with the
      `sts:AWSServiceName=codeartifact.amazonaws.com` condition.
- [x] Add `test/artifacts-stack.test.ts` covering the domain/repository/upstream, KMS key,
      retention, tags, SSM parameters, and scoped IAM policies.
- [x] Add `docs/artifact-repository.md` with local SSO login, `aws codeartifact login
      --namespace @stevenclarke`, npm publish/consume examples, CI token-refresh example,
      package naming/versioning rules, and troubleshooting.
- [x] Update `docs/onboarding-an-application.md` and `README.md` with the artifact SSM
      contract and link to the new guide.
- [x] Run `npm run build`, `npm run lint`, `npm test`, `npm run synth`, and `npm run diff`.
- [ ] Deploy from `main` after approval and verify the published SSM contract.
- [ ] Smoke test: publish a scratch `@stevenclarke/*` package, consume it from a throwaway
      project using only SSM-sourced registry configuration, confirm CloudTrail records the
      publish/read, and review the existing budget dashboard for unexpected cost.

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
- [ ] Self-hosted analytics stack, SSM contract, backups, and alarms (Phase 9).
- [ ] Analytics onboarding documentation with snippet and CSP examples.
- [ ] Analytics backup/restore and operations runbook.
- [ ] Shared Cognito User Pool with Google IdP, `/platform/auth/*` SSM contract, and
      tenant-facing integration documentation (Phase 10).
- [x] Shared CodeArtifact domain/repositories, `/platform/artifacts/*` SSM contract, and
      publish/consume documentation (Phase 11).

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
| Analytics pushes recurring spend past `$10/month` | Prefer GoatCounter or Umami on one EC2 host; avoid RDS, ALB, NAT, and multi-service stacks; explicitly approve any budget increase before implementation. |
| Selected analytics tool is too heavy for the budget or host | Validate footprint before selection; prefer SQLite or a co-located PostgreSQL database; reject ClickHouse/PHP/MySQL stacks unless the budget is raised. |
| Analytics tracking is blocked by ad blockers, CSP, or SPA routing | Serve the tracker from the self-hosted analytics host; document CSP updates; verify history navigation; add manual pageview calls where needed. |
| Analytics endpoint outage affects tenant applications | Use an async/defer snippet that fails open; never block rendering; alarm on endpoint health and error rate. |
| Visitor privacy regression or unexpected cookies | Choose cookie-free defaults; disable unnecessary data collection; document retention; update privacy notices; review configuration before launch. |
| Single EC2 host is a single point of failure or patch burden | Automated EBS snapshots and S3 backups; SSM patching and Session Manager; alarms; tested restore; accept low criticality or revisit ECS/RDS later. |
| Analytics data loss | Litestream or scheduled database dumps plus EBS snapshots; versioned private S3 bucket; periodic restore test. |
| Tenant analytics integration drifts | Treat SSM keys as a versioned contract; publish per-app site IDs; document snippet and CSP changes in the onboarding guide. |
| Shared identity pool is misconfigured so one app affects another | Public PKCE clients only, with no shared client secret; the platform owns the IdP and Google client; app clients are restricted to their own callback URLs; review IAM grants during Phase 8. |
| Google OAuth client secret compromise or Google outage blocks all tenant sign-in | Keep the secret only in platform Secrets Manager with a documented rotation path; optionally keep one break-glass Cognito-native user with MFA; document the dependency in the tenant integration guide. |
| Cognito domain prefix is taken or an app hardcodes it | Read domain and issuer from `/platform/auth/*` SSM at deploy/runtime so the prefix or a future custom domain can change without app changes. |
| Cognito advanced security or a custom domain pushes spend over `$10/month` | Use the Standard (free) feature tier and Cognito-provided domain at launch; revisit the budget before enabling advanced security or a custom domain. |
| CodeArtifact becomes a single point of failure for builds | Retain packages and the KMS key; document the upstream-cache behavior; keep the public fallback path documented; require a deliberate approval before deleting domain resources. |
| Over-broad artifact publish access lets one app overwrite another team's package namespace | Enforce the `@stevenclarke/*` scope, immutable versions, and opt-in publish grants; review `config/applications.ts` and IAM resources during Phase 8 hardening. |
| Long-lived registry tokens leak | Generate short-lived CodeArtifact tokens per job, never cache them, and use the SSO profile locally with a namespace-scoped npm login. |


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
6. [x] **Analytics technology**: **GoatCounter** (single Go binary, SQLite, ~0.5 GB RAM, cookie-free). Arm64 binaries are published with each release, so Gravitron `t4g.nano` is supported.
7. [x] **Analytics hosting**: **single EC2 `t4g.nano`** in the shared VPC (public subnet) behind CloudFront. Fit to `$10/month` (~`$4–7` incremental).
8. [x] **Analytics budget**: the `$10/month` target is kept; GoatCounter fits without an increase.
9. [x] **Analytics site model**: one site per `<app>-<environment>`; preview sites are created only when a tenant opts in. Site IDs are published to SSM when each app is onboarded.
10. [x] **Analytics retention and privacy**: cookie-free by default; 24-month retention target; GoatCounter stores aggregates (no per-hit table by default). Litestream snapshots to S3 every 6h.
11. [x] **Analytics access model**: single owner dashboard account (email + password), generated via Secrets Manager.
12. [x] **End-user login mechanism**: platform-owned Cognito User Pool with a Google federated IdP (Phase 10), not IAM Identity Center (workforce/admin only) and not direct per-app Google OAuth.
13. [x] **Google OAuth client ownership**: one platform-owned client; secret in Secrets Manager; redirect URI fixed to the Cognito Hosted UI `/oauth2/idpresponse` endpoint.
14. [x] **Per-app OAuth client ownership**: applications own their own clients, callback/logout URLs, scopes, and token lifetimes; the platform grants scoped `cognito-idp` permissions.
15. [x] **Cognito domain and pool scope**: Cognito-provided domain; one user pool shared across all apps and `preview`/`prod` environments.
16. [x] **Global artifact repository scope**: AWS CodeArtifact domain `stevenclarke` in `us-east-2`, one `shared` publish repository, npm `@stevenclarke/*` packages first, opt-in publish access, and no cross-account or multi-format support until needed (Phase 11).

## CI/CD setup notes (Phase 6)
- Configure GitHub Environment: `production` (required reviewers). No `preview` environment is needed for this repository.
- Set repository variable: `PLATFORM_DEPLOY_ROLE_ARN` (from SSM `/platform/roles/...`).
- Branch protection: require PR reviews for `main`.
- Manual deployment: `deploy-manual.yml` is a `workflow_dispatch` workflow that deploys the platform stacks. It runs `cdk diff` first, then deploys only when the `confirm` input is set to `deploy`. It uses the `production` environment (required reviewers) and the `platform-deploy-prod` role, so it must be triggered from `main` (the role's OIDC trust is scoped to `ref:refs/heads/main`).

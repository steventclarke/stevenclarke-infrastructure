# Internal Artifact Repository

The platform owns a single global AWS CodeArtifact domain for publishing and consuming
internal libraries. It is intended for packages shared across tenant applications, not for
application deployment artifacts or per-app registries.

This repository is platform-global: there is no `preview` or `prod` copy. Package names and
immutable versions separate consumers.

## Ownership

| Concern | Owner |
| --- | --- |
| CodeArtifact domain, KMS key, repositories, and IAM grants | Platform (`ArtifactsStack`) |
| `/platform/artifacts/*` SSM contract | Platform |
| Local login and CI token refresh | Developer / application CI |
| Package naming, semver, and publishing | Library owner |

There is one publish repository, `shared`, and one public npm upstream repository, `npmjs`.
Only packages in the `@stevenclarke/*` npm scope are published to `shared`. Public packages
are cached on demand through `npmjs`; nothing is copied at deploy time.

## SSM contract

All parameters are in `us-east-2`.

| Parameter | Purpose |
| --- | --- |
| `/platform/artifacts/codeartifact/domain` | CodeArtifact domain name (`stevenclarke`) |
| `/platform/artifacts/codeartifact/domain-owner` | AWS account ID that owns the domain |
| `/platform/artifacts/codeartifact/region` | Domain region (`us-east-2`) |
| `/platform/artifacts/codeartifact/repository` | Publish repository (`shared`) |
| `/platform/artifacts/codeartifact/npm-registry-url` | npm registry URL for `@stevenclarke/*` |
| `/platform/artifacts/codeartifact/npm-scope` | First-party npm scope (`@stevenclarke`) |

Read these values at runtime or deploy time instead of hardcoding the domain, account, or
registry URL.

## Local setup with SSO

Use the platform's SSO profile and a namespace-scoped npm login. The `--namespace` flag
sets `@stevenclarke:registry` only; it does not replace the default npm registry.

```bash
export AWS_PROFILE=admin
aws sso login --profile admin

DOMAIN=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/domain \
  --region us-east-2 --query Parameter.Value --output text)
OWNER=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/domain-owner \
  --region us-east-2 --query Parameter.Value --output text)
REGION=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/region \
  --region us-east-2 --query Parameter.Value --output text)
REPOSITORY=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/repository \
  --region us-east-2 --query Parameter.Value --output text)
SCOPE=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/npm-scope \
  --region us-east-2 --query Parameter.Value --output text)

aws codeartifact login \
  --tool npm \
  --domain "$DOMAIN" \
  --domain-owner "$OWNER" \
  --region "$REGION" \
  --repository "$REPOSITORY" \
  --namespace "$SCOPE"
```

The npm auth token expires after 12 hours. Re-run `aws codeartifact login` when commands
start returning `401 Unauthorized`.

## Publishing a package

Package names must use the `@stevenclarke/*` scope. Versions are immutable: never republish
a version. Bump the version for every change.

```json
{
  "name": "@stevenclarke/example-library",
  "version": "1.0.0"
}
```

```bash
npm publish
```

## Consuming a package

Prefer exact versions or a tightly controlled range. Do not depend on `latest` for builds.

```bash
npm install @stevenclarke/example-library@1.0.0
```

The app's deploy roles have read access by default. Publish access is opt-in per
application; set `publishArtifacts: true` on the application's entry in
[`config/applications.ts`](../config/applications.ts) when a tenant app needs to publish.

## CI token refresh

Generate a short-lived token for each job. Do not cache it in repository secrets, npm
configuration files, or build artifacts.

```bash
DOMAIN=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/domain \
  --region us-east-2 --query Parameter.Value --output text)
OWNER=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/domain-owner \
  --region us-east-2 --query Parameter.Value --output text)
REGION=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/region \
  --region us-east-2 --query Parameter.Value --output text)
REPOSITORY=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/repository \
  --region us-east-2 --query Parameter.Value --output text)
SCOPE=$(aws ssm get-parameter \
  --name /platform/artifacts/codeartifact/npm-scope \
  --region us-east-2 --query Parameter.Value --output text)

ENDPOINT="${DOMAIN}-${OWNER}.d.codeartifact.${REGION}.amazonaws.com/npm/${REPOSITORY}/"
TOKEN=$(aws codeartifact get-authorization-token \
  --domain "$DOMAIN" \
  --domain-owner "$OWNER" \
  --region "$REGION" \
  --query authorizationToken --output text)

npm config set "//${ENDPOINT}:_authToken" "$TOKEN"
npm config set "${SCOPE}:registry" "https://${ENDPOINT}"
```

## Cost and durability

The domain uses a dedicated customer-managed KMS key without automatic rotation, adding
about `$1/month` under the existing `$10/month` platform budget. The domain, repositories,
and KMS key are retained on stack deletion; CodeArtifact requires empty repositories before
deletion and package loss would break downstream builds.

## Troubleshooting

- **`401 Unauthorized`**: the CodeArtifact token expired; re-run the login command.
- **`403 Forbidden` on package install**: confirm the app role is registered in the
  platform and has read access; check that the request uses the `shared` repository endpoint.
- **`403 Forbidden` on publish**: confirm `publishArtifacts: true` is set for the app and
  that the package name starts with `@stevenclarke/`.
- **Package not found**: confirm the app's npm config points at the scoped registry URL and
  that the package version exists. Public packages are fetched through the `npmjs` upstream;
  they are not copied into `shared`.
- **Wrong endpoint or account**: read the domain, owner, region, and repository from SSM
  instead of hardcoding them.
- **Need to change the KMS key**: CodeArtifact domain encryption is fixed at creation.
  Changing it requires a new domain and a deliberate package migration.

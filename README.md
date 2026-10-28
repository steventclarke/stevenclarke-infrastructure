# stevenclarke-infrastructure

Centralized platform infrastructure for `stevenclarke.dev`. This repository owns the shared AWS platform (Route 53, ACM certificates, shared VPC, GitHub OIDC, IAM roles, monitoring) while application repositories deploy their own infrastructure independently.

## Repository structure

- [spec.md](./spec.md) - Original specification
- [plan.md](./plan.md) - Detailed implementation plan and decisions
- `bin/` - CDK app entrypoint
- `lib/` - CDK stacks
- `config/` - Environment and application configuration
- `docs/` - Documentation (e.g. application onboarding)
- `.github/workflows/` - CI/CD workflows

## AWS authentication (IAM Identity Center SSO)

This project uses AWS IAM Identity Center (SSO) for authentication. The CLI requires a profile configured with SSO and the `AWS_PROFILE` environment variable.

### Initial setup

1. Enable IAM Identity Center in the AWS Console (region `us-east-2`).
2. Create a user in the Identity Center directory and assign the `AdministratorAccess` permission set to the AWS account.
3. Copy the AWS Access Portal URL from Identity Center settings.
4. Configure the CLI profile:

```bash
aws configure sso --profile admin
```

When prompted:
- SSO session name: `stevenclarke` (or your preferred name)
- SSO start URL: your AWS Access Portal URL
- SSO region: `us-east-2`
- SSO registration scopes: leave default (`sso:account:access`)
- After browser authentication, select your AWS account and `AdministratorAccess`
- CLI default client Region: `us-east-2`
- CLI default output format: `json`
- CLI profile name: `admin`

5. Add `AWS_PROFILE` to your shell profile (e.g. `~/.zshrc`):

```bash
echo 'export AWS_PROFILE=admin' >> ~/.zshrc
source ~/.zshrc
```

### Daily usage

```bash
# Log in to SSO (tokens expire periodically)
aws sso login --profile admin

# Verify credentials
aws sts get-caller-identity

# Use AWS CLI/CDK as normal
cdk synth
cdk diff
cdk deploy
```

Tokens expire periodically. If you get `Unable to locate credentials`, run `aws sso login --profile admin` again. If you need to switch profiles, unset or change `AWS_PROFILE`.

## Development

1. Install dependencies: `npm install`
2. Synthesize: `cdk synth`
3. Diff: `cdk diff`
4. Deploy (requires approval on `main`): `cdk deploy --all`



## Branch conventions

- `main`: Production release candidates; merges require PR approval via the `production` environment.
- `preview`: Integration branch; merges auto-deploy to preview (no required reviewers).
- `phase/<n>` or `phase/<n>-<description>`: Phase branches for plan-driven work (e.g., `phase/0`, `phase/1-aws-and-cdk-bootstrap`).

## Contributing

- Application repositories deploy independently via their own CI/CD pipelines.
- Shared platform changes are made in this repository and deployed from `main` with manual approval.
- Follow the conventions in [plan.md](./plan.md).

## Operational resources

Global resources (DeveloperRole, Budget/Alerts) are deployed separately and are not part of application deployments:

```bash
npm run deploy:ops
```

## Preview environments

Preview resources run in the same account as production and are tagged `Environment=preview`. They are **manually cleaned up** to control cost under the $10/month budget (see [docs/preview-cleanup.md](docs/preview-cleanup.md)). If spend alerts indicate persistent idle previews, we may automate cleanup later.

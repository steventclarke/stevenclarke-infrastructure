# AGENTS.md

Working conventions for this repository.

## Branching and PR workflow

Follow this process for all changes:

1. **Start from main**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create a phase/feature branch**
   - For plan phases: `phase/<n>` or `phase/<n>-<description>` (e.g., `phase/0`, `phase/1-aws-and-cdk-bootstrap`)
   - For ad-hoc work: use a short descriptive branch name
   ```bash
   git checkout -b phase/1-aws-and-cdk-bootstrap
   ```

3. **Make changes and commit**
   ```bash
   git add <files>
   git commit -m "Concise description of changes"
   ```

4. **Push the branch**
   ```bash
   git push -u origin phase/1-aws-and-cdk-bootstrap
   ```

5. **Create a PR with GitHub CLI**
   ```bash
   gh pr create --base main --head phase/1-aws-and-cdk-bootstrap \
     --title "Phase 1: AWS and CDK bootstrap" \
     --body "Describe changes, link to plan items, and note any follow-ups."
   ```

6. **Address PR comments**
   - Review comments via `gh` or the web UI:
     ```bash
     gh api repos/steventclarke/stevenclarke-infrastructure/pulls/<PR#>/comments
     gh pr view <PR#>
     ```
   - Make updates locally, commit, and push:
     ```bash
     git add <files>
     git commit -m "Address PR comments: <summary>"
     git push
     ```
   - Comments are resolved on GitHub after updates are pushed and reviewed.

7. **Merge**
   - After approval and passing checks, merge via GitHub (squash/rebase/merge as configured).
   - Clean up local branch:
   ```bash
   git checkout main
   git pull origin main
   git branch -d phase/1-aws-and-cdk-bootstrap
   ```

## AWS authentication

Use IAM Identity Center SSO with profile `admin`:
```bash
aws sso login --profile admin
export AWS_PROFILE=admin  # set in ~/.zshrc
aws sts get-caller-identity
```
Tokens expire periodically; re-run `aws sso login` as needed.

## CDK workflow (for this repo)

```bash
npm install
npm run build  # or tsc
cdk synth
cdk diff
cdk deploy --all  # requires approval on main via production environment
```

## Code conventions

- Use TypeScript for CDK.
- Follow existing patterns in `lib/`, `bin/`, `config/`.
- Add tests for stacks where reasonable.
- Use `cdk-nag` to enforce security best practices.
- All resources tagged with `project`, `environment`, `owner`, `application`, `managed-by`.
- Environment names: `preview`, `prod`.
- Region: primary `us-east-2`, certificates in `us-east-1`.

## Commit messages

- Keep concise and descriptive.
- Reference plan phases/items when relevant.
- Do not commit secrets or keys.

## Plan tracking

- Update `plan.md` in your feature branch as you work. Mark items as `[x]` when complete and `[ ]` when pending/in progress as appropriate.
- Follow the same style used in Phase 0 (checkboxes with status notes).
- Keep the plan in sync with decisions made during implementation.

## Operational resources (separate deployment path)

`DeveloperRole` and `MonitoringStack` (budget/alerts) are global operational resources. They are **not** deployed via the normal CDK app.

- Deploy/update: `npm run deploy:ops` or `cdk deploy --app "npx ts-node bin/ops.ts" --all`
- Diff: `npm run diff:ops`
- Synth: `npm run synth:ops`

Never include these in application deploys. Only deploy them when intentionally updating operational/global resources.

# Preview resource cleanup

Preview environments live in the same AWS account as production, tagged with `Environment=preview` (and `environment=preview`). To keep spend under the $10/month budget, preview resources are cleaned up manually for now.

## Policy
- **Lifecycle:** Manual cleanup by the owner/developer. No automated TTL-based deletion is implemented yet.
- **Guardrails:** All preview resources must be tagged `Environment=preview`. Production resources are tagged `Environment=prod`. Shared platform resources follow their own lifecycle.
- **Alerts:** AWS Budget alerts are configured at 50%, 80%, and 100% of forecasted and actual spend. If previews repeatedly trigger alerts, we will re-evaluate and automate cleanup (time-based or PR-based).

## How to clean up preview resources

### Option 1: CDK destroy (recommended)
For each app's preview stack(s), from the app repository (or the stack that owns them):
```bash
# Set the correct profile/region
export AWS_PROFILE=admin
export AWS_REGION=us-east-2

# Preview stacks are typically named like <app>-preview-* or tagged Environment=preview
cdk destroy <stack-name> --force
```

If you're unsure of stack names:
```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
  --query "StackSummaries[?contains(StackName, 'preview')].{Name:StackName,Status:StackStatus}" \
  --output table
```

### Option 2: AWS Console
CloudFormation → Stacks → filter for `preview` → select the stack → Delete. Be careful not to delete production or shared platform stacks.

## Tips
- Clean up previews when you're done testing a feature/PR.
- Check costs in Cost Explorer/Billing if you're concerned about spend.
- Ensure resources you create are tagged with `Environment=preview`, `project`, `owner`, `application`, `managed-by` so they're easy to identify.

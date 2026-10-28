# Regional certificate pattern for direct regional endpoints

## Problem statement

CloudFront requires certificates in `us-east-1` (ACM). Regional services (ALB, API Gateway REST/HTTP in a region, NLB with TLS, App Runner, etc.) require certificates in the same region as the endpoint. 

In this platform:
- Certificates for CloudFront: created in `us-east-1` (done in Phase 3 - wildcard for `*.stevenclarke.dev` and apex `stevenclarke.dev`).
- Applications may need TLS for regional endpoints in `us-east-2` (primary region). 
- SSM is regional. Applications in `us-east-2` need to discover certificate ARNs without relying on cross-region CloudFormation exports (Terraform consumers cannot read CFN exports). 
- We also need a predictable pattern so app repos can request/consume certs consistently.

The Phase 3 action item says: "Document the regional certificate pattern for direct regional endpoints." 

## What "regional certificate pattern" means

A documented convention for when/where to create ACM certificates for regional endpoints, how to validate them (DNS via the shared Route 53 zone), how to make them discoverable (SSM), and how to scope them (SANs/hostnames).

## Current state (resolved)

**Decision:** Use a single top-level wildcard certificate `*.stevenclarke.dev` (plus apex) in `us-east-1` for CloudFront. All application hostnames follow a unified naming convention covered by this wildcard:

| Type | Production | Preview |
| --- | --- | --- |
| Web app | `<app>.stevenclarke.dev` (e.g., `portfolio.stevenclarke.dev`; apex `stevenclarke.dev` for portfolio) | `<app>-preview.stevenclarke.dev` |
| API component | `<app>-api.stevenclarke.dev` | `<app>-api-preview.stevenclarke.dev` |

This eliminates per-application special-case certificates (e.g., no separate `*.squat-monster.stevenclarke.dev` wildcard needed). Regional certificates in `us-east-2` are only required if a regional service (ALB/API Gateway) cannot use the CloudFront certificate or has specific AWS constraints that require a region-specific certificate. This is documented in the plan (see [plan.md](../plan.md) - Decision Log and Open Items).

## Possible approaches

### Approach 1: Platform-owned regional certs via CertificateStack (extend to other regions)
- Extend `CertificateStack` (or add per-region cert stacks) to create regional certs in `us-east-2` when needed.
- Validate via the shared hosted zone (cross-account/region DNS validation works if hosted zone is in same account).
- Publish ARNs to SSM in the consuming region (e.g., `/platform/certs/us-east-2/<name>-arn`).
- Pros: Centralized, consistent validation, easy discovery.
- Cons: Platform repo must know all regional endpoint hostnames in advance; adding a new regional cert requires a platform change.

### Approach 2: Application-owned regional certs with platform DNS delegation/scoped permissions
- Apps create their own ACM certificates in their deployment region.
- DNS validation records go in the shared Route 53 hosted zone; platform grants app roles `route53:ChangeResourceRecordSets` scoped to the zone and specific record sets (as planned in Phase 4).
- Apps publish their own cert ARNs to SSM under app-specific paths or follow a contract (e.g., `/app/<app>/<env>/cert-arn`).
- Pros: Apps own their cert lifecycle, platform doesn't need to know all hostnames upfront.
- Cons: More complex permissions, need clear contract; validation depends on app IAM.

### Approach 3: Hybrid (platform provides wildcard for known patterns, apps create specific certs as needed)
- Platform provides regional wildcards where predictable.
- Apps create additional SAN certs if they need specific hostnames not covered.
- Pros: Balances centralization and flexibility.
- Cons: Wildcards have limitations; need to be explicit about coverage.

## Recommendation (adopted)

**Adopt the unified naming convention above.** With this approach:

1. **When to use us-east-1 vs regional**: CloudFront always uses `us-east-1`. ALB/API Gateway/NLB/App Runner in `us-east-2` use `us-east-2` certs only if required by AWS/service constraints.
2. **Naming/SSM contract**: Regional certs (if needed) published as `/platform/certs/us-east-2/<logical-name>-arn`. API hostnames are `<app>-api.stevenclarke.dev` / `<app>-api-preview.stevenclarke.dev` and are covered by the top-level wildcard `*.stevenclarke.dev` in `us-east-1`.
3. **Validation**: DNS validation using the shared hosted zone. Platform cert stacks handle this when platform-owned.
4. **Scope**: Platform creates regional certs only when necessary per service requirements. Otherwise apps create and manage their own regional certs.
5. **Mirroring**: If a cert is needed cross-region, mirror via SSM or publish in the target region as appropriate.
6. **Permissions**: App roles get read-only access to relevant `/platform/certs/*` SSM params and can reference them in their stacks.

## Open questions

All open questions related to this pattern have been resolved:
- **Squat Monster API ingress** (Open item #2): Resolved in favor of direct regional endpoint in `us-east-2` (ALB/API Gateway) for cost. With unified naming, the API hostname is covered by the top-level wildcard; regional certificate requirements depend on service constraints and are documented as needed.
- **Certificate coverage**: Resolved via unified naming convention using only the top-level wildcard `*.stevenclarke.dev`.

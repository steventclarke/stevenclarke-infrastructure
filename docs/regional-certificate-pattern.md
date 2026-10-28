# Regional certificate pattern for direct regional endpoints

## Problem statement

CloudFront requires certificates in `us-east-1` (ACM). Regional services (ALB, API Gateway REST/HTTP in a region, NLB with TLS, App Runner, etc.) require certificates in the same region as the endpoint. 

In this platform:
- Certificates for CloudFront: created in `us-east-1` (done in Phase 3 - wildcard for `*.stevenclarke.dev` and `*.squat-monster.stevenclarke.dev`).
- Applications may need TLS for regional endpoints in `us-east-2` (primary region). 
- SSM is regional. Applications in `us-east-2` need to discover certificate ARNs without relying on cross-region CloudFormation exports (Terraform consumers cannot read CFN exports). 
- We also need a predictable pattern so app repos can request/consume certs consistently.

The Phase 3 action item says: "Document the regional certificate pattern for direct regional endpoints." 

## What "regional certificate pattern" means

A documented convention for when/where to create ACM certificates for regional endpoints, how to validate them (DNS via the shared Route 53 zone), how to make them discoverable (SSM), and how to scope them (SANs/hostnames).

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
- Platform provides regional wildcards where predictable (e.g., `*.squat-monster.stevenclarke.dev` in us-east-2 if used regionally).
- Apps create additional SAN certs if they need specific hostnames not covered.
- Pros: Balances centralization and flexibility.
- Cons: Wildcards have limitations; need to be explicit about coverage.

## Recommendation (proposal)

Recommend **Approach 1 for platform-known patterns + Approach 2 as fallback** with clear rules:

1. **When to use us-east-1 vs regional**: CloudFront always us-east-1. ALB/API Gateway/NLB/App Runner in us-east-2 use us-east-2 certs.
2. **Naming/SSM contract**: Regional certs published as `/platform/certs/us-east-2/<logical-name>-arn` (e.g., `/platform/certs/us-east-2/squat-monster-api-arn`). With the unified naming convention, API hostnames are `<app>-api.stevenclarke.dev` / `<app>-api-preview.stevenclarke.dev` and are covered by the top-level wildcard `*.stevenclarke.dev` in `us-east-1`; regional certificates are only required if the regional service (ALB/API Gateway) cannot use the CloudFront certificate or requires a region-specific certificate.
3. **Validation**: DNS validation using the shared hosted zone. Platform cert stacks handle this when platform-owned.
4. **Scope**: Platform creates regional certs only when the hostname is part of the platform contract (e.g., Squat Monster API if exposed regionally). Otherwise apps create and manage.
5. **Mirroring**: If a cert is needed cross-region, mirror via SSM (as done for us-east-1 certs) or just publish in target region.
6. **Permissions**: App roles get read-only access to relevant `/platform/certs/*` SSM params and can reference them in their stacks.

## Open questions for review
- Will Squat Monster API be regional (ALB/API Gateway) or only via CloudFront? (Open item #2 in plan)
- Do we need regional wildcards in us-east-2, or specific certs per hostname?
- Should platform pre-create regional certs now, or wait until first app needs them?

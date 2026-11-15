Platform Infrastructure

I own the domain stevenclarke.dev which I purchased from GoDaddy.com

I have an AWS account where I want to host various applications against that domain name

1. Portfolio website at stevenclarke.dev
2. Iron Altar - a strength training webapp at iron-altar.stevenclarke.dev
3. Squat Monster - a computer vision barbell tracking webapp at squat-monster.stevenclarke.dev
4. Media Inspector - a media inspection webapp at media-inspector.stevenclarke.dev

There may be other applications that I want to host against that domain name in the future, but for now these are the ones I want to focus on.

This project is to be a centralized repository for managing the infrastructure for hosting these applications.  The actual infrastructure that powers the applications will be managed by the applications themselves in separate repositories.

I want to standardize the infrastructure as code approach to use AWS CDK across all of the applications, but in theory this approach should also work if one of the applications was using something like terraform.

This project repository is in GitHub and must support a CI/CD pipeline based on git commits to the main branch to deploy the infrastructure to AWS.

Individual application repositories should support a CI/CD pipeline to ship new versions of the application to AWS without requiring a deployment pipeline in this repository.

## Website analytics

I want to self-host an open-source website analytics solution to monitor my portfolio website and the tenant applications hosted on this platform. The analytics platform should be owned by this repository, keep visitor data in my AWS account, avoid third-party tracking where practical, support multiple sites (portfolio, Iron Altar, Squat Monster, and Media Inspector), and expose a tracking snippet plus per-site identifiers that each application repository can consume. Technology selection, hosting, cost, retention, and implementation details are tracked in `plan.md` Phase 9.

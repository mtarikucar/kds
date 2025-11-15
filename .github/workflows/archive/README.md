# Archived Workflows

This directory contains workflows that have been archived due to redundancy or issues.

## Archived Files

### ci-cd.yml
- **Archived on**: 2025-10-31
- **Reason**:
  - Redundant with `release-deploy.yml`
  - Had invalid workflow syntax (secrets used in environment.url)
  - Comprehensive deployment functionality now handled by dedicated workflows
- **Replacement**: Use `release-deploy.yml` for production deployments

### deploy-production.yml
- **Archived on**: 2025-10-31
- **Reason**:
  - Redundant with `release-deploy.yml`
  - Both workflows provided tag-based production deployment
  - Consolidated to single workflow to reduce maintenance
- **Replacement**: Use `release-deploy.yml` for production deployments

## Active Workflows

The following workflows are currently active and maintained:

- **release-deploy.yml** - Primary production deployment (triggered by version tags)
- **test.yml** - Reusable test workflow (called by other workflows)
- **pr-staging.yml** - PR preview environments (isolated staging per PR)
- **deploy-staging.yml** - Staging environment deployment (triggered by main branch)

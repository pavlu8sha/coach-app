# Code Review Standard

## Purpose

This document defines the mandatory review process for Coach App pull requests. The goal is to detect functional defects, security and data-integrity risks, UI/UX regressions, and compatibility problems before changes reach production.

A green CI run is useful evidence, but it is not proof that a change is correct, secure, usable, or regression-free.

## Review principles

1. **GitHub is the source of truth.** Review the current Issue, pull request, branch, diff, commits, CI results, and relevant discussions. Do not rely solely on old review notes or developer summaries.
2. **Understand the existing implementation first.** Trace the affected architecture, data model, call sites, shared components, and adjacent user journeys before recommending a change.
3. **Preserve approved product behavior.** Compare the implementation with the Issue acceptance criteria and the owner's latest decisions. Do not silently change product rules or expand permissions.
4. **Verify enforcement at the correct boundary.** UI restrictions do not replace server-side authorization, database constraints, RLS, or RPC validation.
5. **Review the whole change, not only the changed lines.** Inspect relevant callers, consumers, related screens, historical data, and concurrent workflows.
6. **Separate evidence from assumptions.** State what was inspected and executed, what was inferred, and what could not be verified.
7. **Do not perform production operations as part of review.** No deploy, merge, production migration, backfill, real-data mutation, or real notification without explicit owner approval.

## Mandatory review dimensions

Every PR must be reviewed across the dimensions below. The depth depends on the risk and scope of the change, but no dimension may be silently skipped. Mark an item as not applicable only with a short reason.

### 1. Requirements and product behavior

- Read the linked Issue and all acceptance criteria.
- Check the latest owner decisions and relevant comments in linked Issues/PRs.
- Verify that the implementation satisfies the requested behavior and does not introduce unapproved behavior.
- Check role-specific behavior for administrator, coach, parent, child, and guest where relevant.
- Identify ambiguous or contradictory requirements and request clarification instead of guessing.
- Check that error, cancellation, retry, and recovery behavior matches the approved flow.

### 2. Functional correctness and end-to-end flows

- Trace the complete user journey, not just the modified function or component.
- Inspect all relevant call sites, consumers, shared helpers, and state transitions.
- Check loading, empty, success, validation, error, retry, and partial-failure states.
- Check duplicate submissions, repeated actions, refreshes, navigation away/back, and stale state.
- For asynchronous or multi-user operations, consider race conditions, concurrent updates, idempotency, and ordering.
- Verify that persisted values and subsequent screens reflect the same result.
- Check boundary values, missing/null values, malformed input, and legacy records where relevant.

### 3. UI/UX and accessibility

For changes that affect a screen, component, interaction, layout, or user journey:

- Inspect the actual rendered interface where a suitable runtime or preview is available. Source-code inspection alone is not a visual review.
- Check narrow mobile widths (including 320–430 px), tablet, and desktop layouts as applicable.
- Check light and dark themes where supported.
- Check loading, empty, error, success, disabled, validation, and confirmation states.
- Check scrolling, sticky elements, overlays, dialogs, dropdowns, keyboard behavior, focus, and return-to-screen behavior.
- Look for clipped content, horizontal overflow, overlapping controls, inaccessible actions, unstable layout, and misleading visual hierarchy.
- Check whether users can understand the current state, available actions, consequences, and recovery path.
- Check that the change does not add unnecessary steps, lose user context, or make common actions harder.
- Consider keyboard and assistive-technology access for interactive controls.

**Evidence rule:** distinguish explicitly between (a) source-code inspection, (b) automated UI/component tests, and (c) rendered visual/manual interaction checks. Do not claim a visual or manual check unless it was actually performed. If the app cannot be run or the relevant state cannot be reproduced, record the limitation and use a conditional status when that limitation is material.

### 4. Architecture, security, and data integrity

Check the relevant items for the affected area:

- Authentication and authorization on the server/database boundary.
- RLS policies, grants, RPC execute permissions, and security-definer behavior.
- Club/tenant isolation: IDs and relationships must be validated against the same authorized club, not merely accepted from the client.
- Role boundaries and least privilege; do not rely on hidden UI controls.
- Database constraints, foreign keys, transaction boundaries, rollback behavior, and partial-failure handling.
- Idempotency, duplicate prevention, concurrent writes, locking, and race conditions.
- Data ownership and attribution, especially for financial records and audit fields.
- Migration ordering, reversibility where practical, compatibility with existing and historical data, and safe defaults for nullable/legacy fields.
- Query count, N+1 patterns, pagination, indexes, payload size, and avoidable repeated work where performance may be affected.
- Logging and error handling: useful for diagnosis without exposing secrets or sensitive personal data.

For financial, attendance, permissions, club-isolation, or schema changes, perform a deeper review of all related data paths and invariants. A passing unit test or CI job does not replace validation of database-level enforcement.

### 5. Regression and integration impact

- Search for every relevant use of changed functions, components, types, tables, RPCs, and API contracts.
- Inspect adjacent screens and related user journeys that share the modified code or data.
- Check compatibility with existing records and previously supported flows.
- Check whether the PR overlaps with other open PRs, migrations, or in-progress refactors.
- Identify changed defaults, feature flags, permissions, and fallback behavior.
- Ensure tests cover the most important neighboring behavior, not only the new happy path.
- Record any integration or sequencing dependency that must be resolved before merge.

## Risk-based depth

Use the following minimum depth; increase it whenever the blast radius is unclear.

| Change type | Minimum review depth |
|---|---|
| Copy, label, or isolated visual adjustment | Requirements, affected component context, responsive/layout regression, relevant tests |
| Screen, component, or user journey | All five dimensions, including rendered UI/manual interaction when available |
| API, RPC, roles, RLS, club isolation, or authentication | Deep server-side security review, negative authorization tests, regression/call-site analysis |
| Finance, payments, attendance, or other business-critical records | Deep invariants, transaction/rollback, concurrency/idempotency, historical-data compatibility, end-to-end flows |
| Database schema or migration | Migration review, grants/RLS, constraints, existing-data compatibility, rollback/forward safety, dependent code |
| Cross-cutting or multi-area change | Combined deep review and explicit dependency/conflict analysis |

## Required evidence in every review report

Every review report must state:

1. **Scope and revision:** PR number, current head commit, base branch, and the files/areas inspected.
2. **Requirements:** which Issue criteria and owner decisions were checked.
3. **Findings:** each defect with severity, evidence, impact, and a concrete remediation.
4. **Automated checks:** exact tests/workflows inspected or run and their results. Distinguish CI results from tests run locally or manually.
5. **Manual/UI checks:** exact scenarios and viewport/theme/state checked, or an explicit statement that no visual/manual check was possible.
6. **Not checked:** missing environments, inaccessible states, unavailable test data, or other verification gaps.
7. **Residual risk:** what could still fail and why.
8. **Recommendation:** one of the review statuses below.

Do not state that a scenario passed if it was not actually executed or adequately covered by a test. Do not infer successful UI behavior solely from JSX/CSS inspection.

## Review statuses

- **BLOCK** — a critical or high-impact defect, security/data-integrity violation, or unapproved behavior makes the PR unsafe to merge.
- **CHANGES** — concrete corrections are required before the PR can be accepted; the issue may be less severe than BLOCK but remains material.
- **CONDITIONAL** — no known blocking code defect remains in the inspected scope, but one or more material checks are outstanding (for example, rendered UI verification, integration validation, or an unresolved dependency). State exactly what must be checked before merge.
- **PASS** — the required review scope has been checked, findings are resolved, relevant tests are adequate and successful, and no material verification gap remains for the risk level.

A green CI result alone can never justify PASS. PASS is a review recommendation, not permission to merge or deploy. The owner retains final approval.

## Finding quality and prioritization

Each finding should include:

- **Severity:** BLOCKER / HIGH / MEDIUM / LOW.
- **Location:** file and line or the precise affected flow.
- **Evidence:** the code path, test result, reproduction, or missing invariant supporting the finding.
- **Impact:** what can happen to users, data, permissions, or operations.
- **Required correction:** the expected behavior or invariant, without prescribing unnecessary implementation details.
- **Regression tests:** specific positive and negative cases that should be added or updated.

Avoid speculative findings. If impact depends on an assumption, state the assumption and how to verify it. Group duplicate symptoms under the underlying root cause.

## Re-review after fixes

When a developer reports that findings are fixed:

1. Refresh the PR metadata, head SHA, diff, changed files, review threads, and CI results.
2. Confirm that the reported fix is present in the current diff; do not rely on the report.
3. Re-check each prior finding against the new implementation and tests.
4. Inspect nearby code and newly introduced changes for regressions.
5. Re-run or inspect relevant checks for the new head SHA.
6. Update the recommendation only from the new evidence.

A re-review is not a rubber stamp and must not assume that a previously identified issue is fixed merely because a comment was marked resolved.

## Operational safety

- Review work should be read-only by default.
- Do not merge, deploy, push, run production migrations/backfills, mutate production data, or send real notifications without explicit owner approval.
- Treat any shared production-backed development endpoint as production for data-safety purposes.
- Prefer isolated test data and non-production environments. If none exist, do not use production-backed endpoints for destructive or state-changing tests.
- Report when the available environment prevents safe verification.

## Final rule

The purpose of review is to reduce the probability of defects reaching users, not to maximize the number of comments or to produce a PASS quickly. Be specific, evidence-based, risk-aware, and honest about verification limits.

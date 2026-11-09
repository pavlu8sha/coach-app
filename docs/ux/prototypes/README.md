# Coach App — UX prototype archive

**Branch:** `ux/prototypes-266`  
**Issue:** [#266 — Профиль игрока и система развития](https://github.com/pavlu8sha/coach-app/issues/266)  
**Status:** all screens below are reconstructed visual wireframes / **PROPOSAL**, not approved final UI and not implementation-ready. They are based on the previously discussed and recorded UX decisions. They are kept here because Figma export/editing is currently blocked by the Starter plan limit.

## Earlier prototypes reconstructed and archived

| ID | Screen | Preview |
|---|---|---|
| A1 | Player card without photo | [SVG](player-card-no-photo.svg) |
| A2 | Player profile — mobile | [SVG](player-profile-mobile.svg) |
| A3 | Photo and consent — mobile | [SVG](photo-consent-mobile.svg) |
| A4 | Individual goal detail — mobile | [SVG](individual-goal-detail-mobile.svg) |
| A5 | Coach testing entry — mobile | [SVG](testing-entry-coach-mobile.svg) |

## New testing-result prototypes

| ID | Screen/state | Preview |
|---|---|---|
| A6 | Test result — parent/child mobile | [SVG](test-result-parent-mobile.svg) |
| A7 | Testing review — staff desktop | [SVG](testing-review-staff-desktop.svg) |
| A8 | No comparable previous result | [SVG](test-result-no-previous.svg) |
| A9 | Only one valid result in the session | [SVG](test-result-single-valid.svg) |
| A10 | Corrected published result — parent/child view | [SVG](test-result-corrected.svg) |
| A11 | Incomparable tests / no trend | [SVG](test-result-incomparable.svg) |
| A12 | Bulk skip — selection and confirmation | [coach-testing-bulk-skip-v1.svg](coach-testing-bulk-skip-v1.svg) |
| A13 | Testing review and publication checklist | [coach-testing-review-publish-v2.svg](coach-testing-review-publish-v2.svg) |
| A14 | Player goals — coach list and parent/child detail | [player-goals-coach-parent-v1.svg](player-goals-coach-parent-v1.svg) |
| A15 | Create/edit individual goal — coach | [player-goal-create-edit-coach-v1.svg](player-goal-create-edit-coach-v1.svg) |
| A16 | Player testing history and personal progress | [player-testing-history-progress-v1.svg](player-testing-history-progress-v1.svg) |
| A17 | Anonymous group comparison — parent/child | [player-group-anonymous-comparison-v1.svg](player-group-anonymous-comparison-v1.svg) |
| A18 | Player photo management and separate public consent | [player-photo-parent-consent-v1.svg](player-photo-parent-consent-v1.svg) |

## Important interpretation

- A1–A5 are **reconstructed** from the earlier chat specifications and the current Issue #266 record. They are not claimed to be byte-for-byte copies of unavailable Figma/chat artifacts.
- A6–A18 are new visual wireframes to make the test-result flow and edge states reviewable directly in GitHub.
- Sample names, dates and values are illustrative only.
- Product decisions already recorded in Issue #266 remain authoritative. These drawings do not approve new business rules.
- The parent/child correction view intentionally shows only that the result was corrected and the current value. Detailed audit data (old/new values, author, time, reason) belongs to the authorized staff view.
- Responsive sizes, UI-kit tokens, real data labels and exact component behavior must be validated before handoff.

## Integrated player profile — information architecture and role views

| ID | Screen / document | Preview |
|---|---|---|
| A19 | Integrated parent/child player profile — mobile | [SVG](parent-player-profile-integrated-v2.svg) |
| A20 | Staff player profile — desktop | [SVG](staff-player-profile-desktop-v1.svg) |
| A21 | Unified information architecture, data boundaries and acceptance criteria | [Specification](player-profile-information-architecture-v1.md) |
| A22 | Responsive mobile states — 320/390/430 px, light/dark, empty/error/loading | [SVG](player-profile-mobile-states-v1.svg) |
| A23 | Parent profile detail tabs — matches and training history/data boundaries | [SVG](parent-player-profile-matches-trainings-v1.svg) |

### Notes for A19–A21

- The parent/child profile is entered from the existing child card; the existing bottom navigation is not replaced.
- The service view preserves the existing staff-card tabs. The new «Развитие» area is a proposal and is not an approved change to the current application.
- The proposed «Тренировки» section must not show a fabricated personal group-training history: the current implementation does not yet provide a confirmed complete source for it.
- «Достижения» remain a placeholder until the product defines their source and rules. Points, test ranking and achievements are separate concepts.
- A22 checks narrow mobile composition and loading/empty/error states; final tokens and interaction details still require UI-kit validation.
- A23 distinguishes team match information from confirmed player participation and separates individual/extra bookings from the currently unavailable complete personal group-training history.
- Names and values in the drawings are illustrative; no sample values should be treated as live player data.


## Progress and achievements

| ID | Screen / state | Preview |
|---|---|---|
| A24 | Parent/child progress and staff development view; achievements remain an explicitly neutral placeholder until product rules are defined | [SVG](player-progress-achievements-parent-staff-v1.svg) |

### Notes for A24

- Personal progress remains the primary view; group comparison is limited to approved anonymous aggregates for a selected comparable testing session.
- The screen keeps points, objective tests and achievements as separate concepts. It does not infer achievements from points or test rankings.
- No invented metrics, streaks, percentages, badges, reward levels or sample player results are displayed.
- The achievements area is an informational placeholder until the product defines the source, eligibility rules, award lifecycle and visibility permissions.
- Parent and child see the same player-development information. Staff access remains role- and group-scoped.


## Cross-screen UX review

| ID | Document | Purpose |
|---|---|---|
| A25 | [Cross-screen player profile UX audit](player-profile-cross-screen-ux-audit-v1.md) | End-to-end role, data-source, privacy, responsive-state and handoff audit; separates UX requirements from unresolved product decisions |

### Notes for A25

- The audit is a review/handoff aid, not implementation approval.
- It records data-source dependencies for match participation and personal group-training history.
- It keeps achievements and photo/consent decisions open for product confirmation.
- A22 was cleaned up to remove realistic-looking sample identity and points values.


## FC Kickstart collection card

| ID | Screen / document | Preview |
|---|---|---|
| A26 | Collection card — front with/without photo, reverse side and mobile export preview | [SVG](kickstart-player-collection-card-front-back-v1.svg) |
| A26 spec | Card fields, consent gating, QR, export behavior, states and acceptance criteria | [Specification](kickstart-player-card-ux-spec-v1.md) |

### Notes for A26

- The front uses the agreed club-card concept; the no-photo state is a complete branded composition.
- The reverse side reserves space for season statistics and QR, but does not invent metrics or generate a fake working QR.
- Assists, rarity tiers, levels and invented achievements are excluded.
- Public export and photo use remain gated by the separately approved consent model; QR destination and public fields are open product decisions.
- All names and values are placeholders. The SVG is a new UX proposal, not the original Kickstart presentation file.


## Parent mobile collection-card flow

| ID | Screen / document | Preview |
|---|---|---|
| A27 | Parent mobile journey — profile entry, front/back preview, save/share and consent boundary | [SVG](parent-player-card-mobile-flow-v1.svg) |
| A27 spec | Mobile flow, states, privacy boundaries, responsive behavior and acceptance criteria | [Specification](parent-player-card-mobile-flow-v1.md) |

### Notes for A27

- Entry is the existing child card on the «Ребёнок» tab; no new child-profile screen or bottom-navigation change is required.
- The preview switches between front and reverse without editing player data.
- Save and share are separate explicit user actions; sharing uses the system share sheet when supported.
- A personal copy is distinct from publication by the club. Public photo use remains gated by the separately approved consent.
- Missing statistics are not rendered as zero. QR remains inactive until its destination and public fields are approved.
- The flow is a UX proposal, not implementation approval.

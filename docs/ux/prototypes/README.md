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

### Notes for A19–A21

- The parent/child profile is entered from the existing child card; the existing bottom navigation is not replaced.
- The service view preserves the existing staff-card tabs. The new «Развитие» area is a proposal and is not an approved change to the current application.
- The proposed «Тренировки» section must not show a fabricated personal group-training history: the current implementation does not yet provide a confirmed complete source for it.
- «Достижения» remain a placeholder until the product defines their source and rules. Points, test ranking and achievements are separate concepts.
- Names and values in the drawings are illustrative; no sample values should be treated as live player data.

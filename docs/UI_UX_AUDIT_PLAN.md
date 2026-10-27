# Coach App — UI/UX audit and implementation plan

Status: audit plan, not a claim that every screen has been visually inspected. Scope is the React/Supabase app under `web/`; legacy Apps Script UI is out of scope unless a separate screen is explicitly named. No production data, deployment, or database migration is involved.

## Design principles
- Keep the current parent navigation decision: bottom navigation `Ребёнок / Расписание / Матчи / Оплата`; do not reintroduce top tabs.
- Reuse `web/src/ui/` components and `--ks-` design tokens. Do not create a second component system.
- Mobile first: 320, 375, 430 px; desktop layouts must use available width without stretching forms unnecessarily.
- Every asynchronous screen must distinguish loading, success/data, empty state, and error. An error must never silently become an empty list or a zero balance.
- Preserve user context after actions: current section, selected child/group/month, filters, and scroll position where practical.
- Financial actions require a clear summary, explicit confirmation for irreversible/corrective actions, pending state, success feedback, and recoverable failure feedback.
- Accessibility baseline: semantic headings and labels, keyboard focus, sufficient contrast, status not conveyed by colour alone, touch targets around 44 px where practical.

## Prioritised audit matrix

| Priority | Area | Problem / risk to verify | Required outcome |
|---|---|---|---|
| P0 | Payments/cancellations | Cancellation must target a specific source payment; write errors must not look successful. See #247. | Stable source-payment relation or a documented compatible alternative; explicit error/success state; double-submit guard; tests for duplicate equal amounts and insert failure. |
| P1 | Parent payments/debts | Supabase errors for `parent_debts` / `parent_dues` must not be silently swallowed. | Visible error with retry; no false “no debt” state when data failed to load. |
| P1 | Cash desk/camp fees | Failure loading `camp_payments` must not silently display an incomplete list/total. | Screen-level or section-level error; totals clearly marked unavailable until all required sources load. |
| P1 | Post-payment navigation | Saving payment should not reset the user to the start of the payment section. See #241. | Preserve section/selected player/filters/scroll after successful save; on failure keep entered data where safe and explain next step. |
| P1 | Parent schedule/calendar | Child needs one coherent view of past/upcoming training and matches. See #242. | Month/week or agenda view with clear event type, date/time, venue, status and match result when available; useful empty state; timezone-safe dates. |
| P1 | Responsive screens | Long names, tables, date/time inputs, tabs and forms may overflow or clip. | No page-level horizontal scroll at 320/375/430 px; critical content never hidden behind overflow clipping; tables convert to cards or have an explicit local scroll region. |
| P1 | Navigation/context | Actions, back navigation or refresh may reset filters and selection. | Keep relevant context across create/edit/return; clearly show current section and active filters. |
| P1 | Async feedback | Loading, empty and error states may look alike. | Consistent skeleton/loading, empty state with next action, retryable error, and success feedback. |
| P2 | Visual consistency | Spacing, typography, button hierarchy, status pills and forms may vary across screens. | Use shared tokens/components; one primary action per view; destructive/secondary actions visually distinct. |
| P2 | Dark theme | Contrast and native controls may differ by screen. | Verify supported screens in both themes; no unreadable muted text, inputs or status labels. |
| P2 | Accessibility | Focus, field labels, keyboard use and status semantics may be inconsistent. | Inputs have programmatic labels; focus is visible; errors are associated with fields; colour is not the only signal. |

## Visual direction

### Information hierarchy
1. Screen title and key context (selected child/group/date).
2. Primary action or most important summary.
3. Main content/list.
4. Filters and secondary actions grouped together and collapsed only when they are not needed for the main task.
5. Explanatory text below the control it explains, not detached from it.

### Forms and actions
- Use a single-column form on phones; use two columns on desktop only for independent short fields.
- Put labels above fields; do not rely on placeholders as labels.
- Keep save/confirm action in a predictable location; prevent duplicate submission while saving.
- Use explicit confirmation for payments, cancellations, deletion and other consequential actions. Confirmation text must name the child, amount and operation when relevant.
- On failure, show what failed and whether anything was saved. Do not clear the form or show success until the server confirms success.

### Lists and tables
- Mobile: prefer compact cards or rows with the key identity and status first; secondary metadata below. Avoid four-line action button stacks.
- Desktop: wide list/table area, narrow form/editor area. Keep column headers and totals legible.
- Long player names must wrap or truncate with a way to inspect the full name; never push controls off-screen.
- Empty results must distinguish “nothing exists” from “filters returned no results”.

### Payments
- Show amount, payment type, payment month/date and method as separate, unambiguous fields.
- Separate positive payment from correction/cancellation visually and textually.
- Totals must not be presented as final if a required data source failed.
- Preserve selected payment context after recording; make retry safe and idempotent where possible.

### Parent experience
- Child identity should remain visible in the context of schedule, matches and payment.
- Events should distinguish training from match without relying on colour alone.
- Past matches can show score/result; future matches show planned details only.
- If there is no schedule, explain that no events are currently available and avoid implying a loading failure.

## Verification checklist
- [ ] Read-only review of current master, active PRs and branches before touching any screen.
- [ ] For each target screen, record actual route/component and current behaviour before proposing code changes.
- [ ] Browser viewport checks at 320, 375, 430 px and desktop.
- [ ] Light/dark checks on screens where theme switching is implemented.
- [ ] Loading, empty, network error, retry and successful save states.
- [ ] Keyboard/focus and accessible labels for changed controls.
- [ ] Local tests/mocks only; do not run tests against production Supabase.
- [ ] Build and relevant tests pass; report exactly what was and was not tested.
- [ ] No deployment, database migration, or production-data mutation as part of UI work.

## Implementation order
1. Payment correctness/error states (#247) and payment context preservation (#241) — coordinate with the assigned developer; avoid parallel edits to the same files.
2. Parent loading/error states and schedule/calendar (#242), once active PR/file ownership is checked.
3. Responsive overflow and common visual consistency fixes that do not conflict with active UI branches.
4. Accessibility and dark-theme regression pass.
5. Update this document with verified findings and screenshots/results; do not mark an item complete without evidence.

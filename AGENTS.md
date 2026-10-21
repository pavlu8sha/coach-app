# AGENTS.md

## What this is

Google Apps Script web app (FC Kickstart — attendance/coaching for a Tbilisi football club).
Flat repo: every `.js`/`.html`/`.json` at the root is one file in a single GAS project, synced with
clasp (`.clasp.json`, `rootDir: ""`). No package.json, bundler, linter, typecheck, or CI — Node exists
only for tests. All UI strings, comments, error messages, commit messages, and test names are
**Russian**; keep new ones Russian. Errors thrown server-side are user-visible (they double as UI
text and as `assert.throws` patterns — changing an error string can break tests).

## Commands

- All tests: `node --test tests/*.mjs` (bare `node --test` discovers them too)
- One file: `node --test tests/settings.test.mjs`
- One test: `node --test --test-name-pattern='строка из имени теста' tests/<file>.test.mjs`
- Deploy: `clasp push` from repo root (pushes `.js`/`.html`/`.json`; `tests/*.mjs` are not pushed)
- Production health check: run `selfTest` (SelfTest.js) in the Apps Script editor — read-only

### Test baseline

All 112 tests must pass on any OS (verified 112/112 after the CRLF fix). `.gitattributes` enforces
`* text=auto eol=lf`, so fresh checkouts are LF even on Windows. Three tests slice single functions
out of source (`isRecentDup_` from Camps.js, `missOf` from Kit.html) and must keep the
CRLF-tolerant end-of-function search `/\r?\n\}/` — the old `indexOf('\n}\n')` never matched CRLF and
caused 4 phantom failures on Windows.

## Architecture (things filenames don't tell you)

- Entry point is `doGet` in `NavCode.js:59`: routes `?page=key` through `PAGES_`, injects `Nav.html`
  (menu + client PIN gate) and `Ui.html` (design system: tokens, confirm dialog, saving state) into
  the page's `<body>`, appends `PAGE_EXTRAS_` fragments before `</body>`. New page = HTML file +
  `PAGES_` entry (+ `PAGE_EXTRAS_` / `TAB_GROUPS_` if needed). Client→server calls go through
  `google.script.run` via a per-page local `run(fn, args, ok, fail)` helper.
- All `.js` files share one global scope in GAS (no modules, load order irrelevant). Trailing `_`
  marks a private helper (`dbRead_`, `settingGet_`); `app*` are the server functions pages call.
- Two spreadsheets, opened by script-property ID (not the container binding):
  - `ATT_ID` — attendance spreadsheet: registry, month sheets, stats
  - `ADMIN_ID` — "AdminApp": all money sheets, guarded by `AdminDb.js`
  Routing is `sheetOf_` (`Players.js:387`): names in `ADMIN_SHEETS_` go to AdminApp, all others to
  `ATT_ID`. `SpreadsheetApp.getActive()` is only the bound container (selfTest, one-off migrations).
  All file opens go through `clubSource_(propKey, errText)` in `Sources.js` (one open per ID per run;
  texts of «Не задан…» errors are user-visible — don't reword them). `gnFile_` is the exception:
  in prod its file ID is hardcoded in code, the script property exists only in the test project.
- Auth = two PINs in script properties (`APP_PIN` trainer, `APP_ADMIN_PIN` admin), resolved by
  `appWho`/`checkPin_`/`checkAdmin_`. **Every new server function handling data must check a PIN.**
- Config: `CONFIG` in `Attendance.js:19` (`DRY_RUN` — script property `DRY_RUN` = `'true'` makes writes
  no-ops, default off; the app writes to real club spreadsheets, test only on copies) plus a «НАСТРОЙКИ» sheet read through
  `Settings.js` (`settingGet_` with defaults + per-team overrides). Required script properties are
  listed in `SelfTest.js:15`; missing ones throw in production.
- Time-driven triggers: `warmUp` (cache warm-up, every 10 min, Warmup.js:53) and `indAutoTick`
  (hourly, Individual.js:314). `appRefreshData` is the manual "Обновить данные" button.

## Tests

- Harness: `node:test` + `node:assert/strict` + `node:vm`. Each test file builds its own `env()`:
  loads the *real* source files under test into a vm context and stubs everything else (GAS
  services, `dbRead_`, `dbSheet_`, `prop_`, cache…). There is no shared harness or fixtures module.
- Consequence: calling a function from another `.js` file breaks tests that don't load or stub it —
  when adding a cross-file call, update the affected test envs (the current 4 baseline failures are
  exactly this class of drift, masked by the CRLF issue).
- Some tests extract single functions from source by string slicing (`isRecentDup_` from Camps.js,
  `missOf` from Kit.html, `nfSafe_` from SubsPay.js) — brittle, but the established pattern; prefer
  loading whole files when possible.
- Fixture amounts intentionally do **not** match real club fees (stated in test headers) — don't
  "correct" them. Diagnostic console noise from tests is normal.

## Git

`master` is the integration branch; work happens on short-lived `design-*` / `fix-*` / feature
branches merged back («… влит в master»). Commit messages are Russian and describe user-visible
behavior.

## Docs

`IND_PAYFILE_PLAN.md` — status doc for the ind-payfile migration (individual/goalkeeper sessions →
payments file, branch `ind-payfile`); its steps 1 and 2 must deploy together. Trust code over it if
they diverge.

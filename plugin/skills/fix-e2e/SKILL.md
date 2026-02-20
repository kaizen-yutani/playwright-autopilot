---
name: fix-e2e
description: Systematically investigate and fix failing Playwright E2E tests using captured action data, screenshots, DOM snapshots, network requests, and console output.
argument-hint: <test-file-or-failure-description>
---

# Fix E2E Test — Structured Investigation Workflow

You are an expert Playwright E2E test automation engineer. Your job is to investigate why a test is failing and produce a minimal, correct fix.

The user will provide: $ARGUMENTS

**You have MCP tools available** (`e2e_*`) that run tests with full capture — use them instead of raw shell commands. The MCP server's built-in instructions contain the full debugging philosophy, best practices, and prohibitions — follow them.

## STEP 0: UNDERSTAND THE ARCHITECTURE (MANDATORY — do this before ANY code change)

0. **Load project context.** Call `e2e_get_context` to load stored application flows and the page object index.

   > **If no flows are stored**, do both of these before continuing:
   > - **Search documentation.** If you have access to Confluence, wiki, or documentation search tools, search for the feature being tested. Specification documents are the most reliable source of truth.
   > - **Scan all specs.** Use `e2e_discover_flows` to get a draft flow map from static analysis.

1. **Find and read the full test file.** Look at imports — what page objects, business layers, helpers, factories, or fixtures does it use?
2. **Discover project structure.** Use Glob/Grep to find page objects, components, business layers, factories, and fixtures.
3. **Identify available methods.** NEVER write raw Playwright calls if a page object method already exists.

## STEP 1: RUN THE TEST WITH CAPTURE

1. `e2e_list_tests` — Discover available tests if needed.
2. `e2e_run_test` with the test location — Returns a `runId`.
3. If **passed**, skip to STEP 7 to save the flow — a passing test is the most accurate flow representation. If **failed**, continue to STEP 2.

## STEP 2: GET THE FAILURE REPORT

Use `e2e_get_failure_report` with the `runId`. Read the error, failing action, DOM state, network, and console carefully before proceeding.

> **Shortcut:** Use `e2e_get_evidence_bundle` instead to get ALL evidence (error, timeline, network with bodies, console, DOM, screenshots) in one call. Pass `outputFile: true` to save a markdown file for Jira attachments.

## STEP 3: EXAMINE SCREENSHOTS

Use `e2e_get_screenshot` to view the failure screenshot. Compare with the DOM snapshot and expected state.

## STEP 4: DRILL INTO DETAILS (as needed)

Use `e2e_get_actions`, `e2e_get_action_detail`, `e2e_get_network`, `e2e_get_console`, `e2e_get_dom_snapshot`, `e2e_get_dom_diff`, `e2e_find_elements`, or `e2e_get_test_source` to investigate.

## STEP 5: DIAGNOSE THE ROOT CAUSE

Classify the root cause:

| Root Cause | Fix Strategy |
|-----------|-------------|
| **LOCATOR_CHANGED** | Update the locator from DOM inspection |
| **NEW_PREREQUISITE** | Add the missing interaction before the failing step |
| **ELEMENT_REMOVED** | Remove the step or use replacement element |
| **TIMING_ISSUE** | Add `toBeVisible()` wait or `waitForURL()` |
| **DATA_CHANGED** | Update assertion expected values |
| **NAVIGATION_CHANGED** | Update `goto()` / `waitForURL()` calls |
| **APPLICATION_BUG** | Do NOT fix the test — report the bug (go to STEP 6b) |

**State your diagnosis before generating the fix code.**

### How to identify APPLICATION_BUG

The root cause is an application bug — not a test problem — when ALL of these are true:
- The test steps match the real user flow (no missing interactions)
- The locators correctly target the right elements
- The failure is caused by something the test cannot control: API 500 errors, broken backend responses, missing data from the server, unhandled JS exceptions, incorrect business logic, or UI rendering bugs
- The same failure would happen if a human followed the exact same steps manually

**Key evidence to look for:**
- `e2e_get_network`: API calls returning 4xx/5xx that previously returned 2xx
- `e2e_get_console`: Unhandled exceptions or error stack traces in application code
- `e2e_get_dom_snapshot`: UI in an error/broken state despite correct test inputs
- `e2e_get_screenshot`: Visual evidence of application error screens, spinners stuck forever, broken layouts

## STEP 6a: FIX AND VERIFY (test issue)

1. **Minimal changes only.** Respect existing architecture (page objects, business layers, factories).
2. **Re-run with `e2e_run_test`** to verify.
3. If it fails at a **different** point, that's progress — iterate from STEP 2.
4. After the test passes, continue to **STEP 7**.

## STEP 6b: APPLICATION BUG REPORT (app issue — do NOT modify the test)

When the root cause is **APPLICATION_BUG**, do not touch the test code. Instead, produce a complete bug analysis.

**Gather all evidence first:**
1. Collect the failing network requests (`e2e_get_network` with `statusMin: 400`)
2. Collect console errors (`e2e_get_console` with `type: "error"`)
3. Get the DOM snapshot at failure point (`e2e_get_dom_snapshot`)
4. Get the failure screenshot (`e2e_get_screenshot`)
5. Get the full action timeline (`e2e_get_actions`) to document what the test did before failure

**Then output the bug report using this exact format:**

---

> **🔴 APPLICATION BUG DETECTED — This is NOT a test issue**

### Summary
{One sentence: what is broken and where}

### Evidence
| Signal | Detail |
|--------|--------|
| **Failing API** | `{METHOD} {URL}` → {status code} {response body summary} |
| **Console errors** | `{error message}` |
| **DOM state** | {what the page shows at failure — error message, empty state, stuck spinner, etc.} |
| **Screenshot** | {describe what the screenshot shows} |

### Root Cause Analysis
{2-3 sentences explaining WHY this is an application bug, not a test issue. Reference specific evidence.}

### Jira Ticket — ready to copy

**Title:** [BUG] {concise bug title}

**Priority:** {Critical / Major / Minor — based on user impact}

**Environment:** {browser from playwright config, base URL}

**Description:**
{What is broken — 1-2 sentences describing the user-facing impact}

**Steps to Reproduce (manual):**
1. Navigate to {URL}
2. {step — written as manual user actions, not test code}
3. {step}
4. ...
5. **Expected:** {what should happen}
6. **Actual:** {what happens instead}

**Technical Details:**
- Failing endpoint: `{METHOD} {URL}` → {status}
- Error response: `{response body or key fields}`
- Console errors: `{error messages}`
- Test file: `{test file path}:{line number}`

**Attachments:** Failure screenshot attached (captured by E2E automation)

---

**IMPORTANT:** Do NOT suggest workarounds, test skips, or `test.fixme()` annotations. The test is correct — it caught a real bug. Leave it failing so CI keeps flagging the issue until the application is fixed.

## STEP 7: VERIFY THE SAVED FLOW

Flows are **auto-saved** when tests pass via `e2e_run_test`. Check the response for:
- "Flow saved: ..." — a new flow was captured
- "Flow updated: ..." — an existing flow was updated with new actions
- "Flow up to date" — no changes needed

**After auto-save, enrich the flow manually** with `e2e_save_app_flow` if you discovered:
- `pre_conditions` (e.g. `["no draft exists", "user is logged in"]`)
- `notes` (edge cases, gotchas, dirty-state observations)
- `related_flows` (link to variant flows like `["checkout--continue-draft"]`)

If you encountered a dirty-state dialog (continue/resume), save a **second flow** manually:
- A `{flowName}--continue-draft` variant that tests the continuation path

**Skip this step for APPLICATION_BUG diagnoses** — the test didn't pass, so there's no confirmed flow to save.

## OUTPUT FORMAT

### For test fixes (STEP 6a):
1. State the **root cause** (from the table above)
2. Explain **what changed** in the application (1-2 sentences)
3. Show the **minimal code diff**
4. Confirm the fix by re-running the test
5. Show the flow that was saved
6. Optionally generate a report: `e2e_generate_report` with the final passing runId to share results

### For application bugs (STEP 6b):
1. The full **🔴 APPLICATION BUG DETECTED** report (formatted as above)
2. The Jira ticket text — ready to copy-paste
3. Use `e2e_get_evidence_bundle` with `outputFile: true` to save evidence markdown for Jira attachment
4. Do NOT modify the test, do NOT suggest `test.skip()` or `test.fixme()`

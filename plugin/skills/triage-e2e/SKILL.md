---
name: triage-e2e
description: Run all E2E tests, categorize failures (known issue, app bug, test update, flaky, new), cross-reference Jira, and generate a management-ready report.
argument-hint: [project-name-or-options]
---

# E2E Triage — Structured Test Suite Analysis

You are a senior QA engineer running a full test suite triage. Your job is to run every test, classify every failure, cross-reference Jira, and produce actionable reports.

The user may provide options: $ARGUMENTS

## STEP 0: LOAD CONFIG

1. Call `e2e_get_triage_config` to read project settings (Jira config, flaky threshold, default project).
2. Call `e2e_get_stats` to see historical trends — this gives you context for whether failures are new or recurring.
3. If $ARGUMENTS contains a project name, use it. Otherwise use the config's project or run all.

## STEP 1: RUN THE FULL SUITE

Run `e2e_run_test` **without a location** (batch mode) to execute all tests. Use the `project` param if configured.

Note the `runId`, total/passed/failed counts, and duration from the response.

If ALL tests pass: save the triage run with `e2e_save_triage_run` (0 failures), show the pass rate trend from `e2e_get_stats`, and stop.

## STEP 2: CLASSIFY EACH FAILURE

For each failed test, classify it into exactly one category using this decision tree **in order**:

### 2a. Check flaky history FIRST
Look at `e2e_get_stats` output for the flaky tests list. If this test appears with a score >= the configured threshold, classify as **FLAKY**.

### 2b. Get the failure report
Call `e2e_get_failure_report` for the failed test. Examine:
- **Network:** Are there 5xx responses? API errors?
- **Console:** Are there unhandled exceptions in application code?
- **Error message:** What does it say?

### 2c. Check for application bug signals
If the failure shows:
- API calls returning 500+ errors
- Console errors with stack traces in application code (not test code)
- DOM showing error state / broken page

→ Classify as **APP_BUG**

### 2d. Search Jira for known issues
Search Jira for this failure. Try these searches (use Atlassian MCP tools if available):
- Search by the error message (first line)
- Search by the test file name or feature area
- Search by the affected page URL

If Atlassian MCP tools are NOT available, skip this step — you'll output the ticket text for manual search.

If a matching open ticket is found → classify as **KNOWN_ISSUE** and note the ticket key.

### 2e. Determine test update vs new failure
If the error suggests:
- Locator not found / element not visible → likely **TEST_UPDATE** (UI changed)
- Assertion mismatch (expected text differs) → likely **TEST_UPDATE**
- Timeout waiting for element → could be **TEST_UPDATE** or **NEW_FAILURE**

If the test has NEVER failed before (not in history) → **NEW_FAILURE**
If the test has failed recently with a different error → **NEW_FAILURE**
Otherwise → **TEST_UPDATE**

## STEP 3: JIRA ACTIONS

For each classified failure:

### KNOWN_ISSUE
If Atlassian tools available: add a comment to the existing ticket with the latest failure timestamp and a brief note that automated tests are still hitting this.
Otherwise: note the ticket key in the report.

### APP_BUG
If Atlassian tools available AND Jira is configured in triage config:
1. Search first to avoid duplicates
2. If no duplicate found, create a Jira ticket using the config's projectKey, issueType, labels, and component
3. Include: title, description, steps to reproduce, technical details
4. Call `e2e_get_evidence_bundle` with `outputFile: true` and reference the file path

If Atlassian tools NOT available: generate the Jira ticket text in copy-paste format (use the same format as the fix-e2e skill's STEP 6b).

### FLAKY / TEST_UPDATE / NEW_FAILURE
No Jira action — these go in the report only.

## STEP 4: SAVE THE TRIAGE RUN

Call `e2e_save_triage_run` with:
- The runId from step 1
- total, passed, failed counts
- duration
- The full list of categorized failures (with jiraKey if linked, flakyScore if applicable)

This persists the run for trend tracking via `e2e_get_stats`.

## STEP 5: GENERATE REPORTS

### Management Summary (always output this)

Present a clear, scannable summary:

```
## E2E Triage Report — {date}

**Suite:** {total} tests | {passed} passed | {failed} failed | Duration: {duration}
**Pass rate trend:** {last 3-5 rates from stats}

### Categorized Failures

| # | Test | Category | Detail |
|---|------|----------|--------|
| 1 | file.spec.ts:42 | Known Issue | PROJ-1234 — Payment API timeout |
| 2 | file.spec.ts:15 | Flaky (30%) | 3/10 recent runs failed |
| 3 | file.spec.ts:28 | App Bug | 500 on /api/search — PROJ-1301 created |
| 4 | file.spec.ts:55 | Test Update | Button text: "Save" → "Update" |
| 5 | file.spec.ts:92 | New Failure | Needs investigation |

### Actions Taken
- Created: PROJ-1301 (search API 500 error)
- Commented: PROJ-1234 (latest failure evidence added)

### Suggested Next Steps
- {N} tests need code updates. Want me to fix them?
- {N} new failures need investigation. Want me to dig into {test name}?
- {N} flaky tests — consider stabilizing or adding retry
```

### HTML Report (when suite has failures)
Call `e2e_generate_report` with the runId to produce a self-contained HTML file. Mention the file path.

## IMPORTANT RULES

1. **Never auto-fix tests.** Report and suggest — let the user decide.
2. **Be conservative with APP_BUG.** Only classify as app bug when you see clear server-side errors (5xx, console exceptions). If uncertain, classify as NEW_FAILURE.
3. **Always save the triage run.** Even if all tests pass. This builds the trend data.
4. **Keep the summary scannable.** Management doesn't need technical details — they need category, count, and actions.
5. **Offer specific next steps.** After the report, ask if the user wants you to fix the TEST_UPDATE failures or investigate NEW_FAILURE ones (using the fix-e2e approach).

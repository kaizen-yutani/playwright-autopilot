# Playwright Autopilot

**Give Claude Code x-ray vision into your Playwright tests.**

Playwright Autopilot captures every action, DOM snapshot, screenshot, network request, and console message from your test runs — then exposes it all through 37 MCP tools so Claude can debug failures like a senior QA engineer.

> **Stop pasting error logs.** Just say `/fix-e2e tests/checkout.spec.ts` and watch Claude investigate, diagnose, and fix the failure — all inside your terminal.

---

## Why Playwright Autopilot?

Running `npx playwright test` and reading a stack trace tells you *what* failed. Playwright Autopilot tells you **why**.

| Without Autopilot | With Autopilot |
|---|---|
| "Locator `getByRole('button')` timed out" | Full DOM snapshot showing the button was renamed to "Submit Order" |
| "Expected 200, got 400" | Network request body missing `categoryId` because a dropdown was never selected |
| "Test failed" | Screenshot of the actual page + action timeline showing exactly which step broke |
| Manual copy-paste of errors into Claude | Claude runs the test, examines DOM, checks network, and fixes it autonomously |

---

## What You Get

### Action-Level DOM Snapshots

Every Playwright action (click, fill, navigate) captures an **aria snapshot before and after** — so Claude can see exactly what the page looked like at any point in the test. No guessing, no stale screenshots.

```
e2e_get_dom_snapshot → runId, actionIndex: 5, which: "both"

Before: button "Add to Cart" was visible
After:  dialog "Confirm Purchase" appeared with "Total: $42.99"
```

### Inline Failure Screenshots

Claude sees the actual failure screenshot rendered right in your conversation. Not a file path — the image itself.

### Network Request Capture

Every HTTP request during the test is recorded with URL, method, status, headers, and bodies. Filter by URL pattern, method, or status code to find exactly the failed API call.

```
e2e_get_network → runId, statusMin: 400

POST /api/orders → 422 Unprocessable Entity
  Missing required field: "shippingAddress"
```

### Console Output

All `console.log`, `console.error`, and `console.warn` messages captured and filterable.

### Page Object Discovery

Claude automatically scans your `*.page.ts` and `*.service.ts` files to discover every available method, getter, and `@step`-decorated action — so it uses your existing page objects instead of writing raw `page.click()` calls.

### Application Flow Memory

Store confirmed user journeys (like "checkout flow" or "user registration") in `.e2e-flows.json`. Claude cross-references these flows against the test timeline to spot missing steps instantly.

### Static Flow Discovery

No stored flows yet? `e2e_discover_flows` statically analyzes your spec files and extracts the method call sequences per test — giving Claude a flow map without running anything.

### Interactive Browser Exploration

Launch a real Chrome instance and let Claude explore your application interactively — navigate pages, click elements, fill forms, and observe page state through ARIA snapshots. Each interaction returns timing, network requests, DOM changes, and an updated snapshot. Use this to understand an app before writing tests, debug UI issues visually, or verify fixes.

### Evidence Bundles & Reports

`e2e_get_evidence_bundle` packages **all** failure evidence into a single response — error, steps to reproduce, action timeline, failed network requests with bodies, console errors, DOM snapshot, and screenshots. Pass `outputFile: true` to write a markdown file for Jira attachments.

`e2e_generate_report` produces a self-contained HTML report with pass/fail summary, collapsible per-test sections, action timelines, DOM snapshots, and inline base64 screenshots.

### Flaky Detection

Two complementary modes: `retries: N` runs N+1 separate Playwright processes with full action capture per run (verdict: FLAKY / CONSISTENT PASS / CONSISTENT FAIL), while `repeatEach: N` uses native Playwright `--repeat-each` for fast stress-testing (use 30-100).

### Coverage Analysis

`e2e_suggest_tests` scans your page objects, spec files, and stored flows to find untested methods, missing flow variants, and uncovered flow steps.

### Suite Health Tracking

`e2e_get_stats` provides a suite health dashboard — pass rate trends, flaky tests ranked by score, failure category breakdowns, new failures, and duration trends — all from local history without running tests.

---

## Tools Reference

### Test Execution
| Tool | What It Does |
|---|---|
| `e2e_list_tests` | Discover all tests with file paths and line numbers |
| `e2e_list_projects` | List Playwright projects from config |
| `e2e_run_test` | Run a test with full action capture, returns a `runId` |

### Failure Investigation
| Tool | What It Does |
|---|---|
| `e2e_get_failure_report` | One-call failure overview: error, timeline, DOM, network, console |
| `e2e_get_evidence_bundle` | All failure evidence in one call — ready for Jira |
| `e2e_get_screenshot` | Failure screenshot as inline image |
| `e2e_get_actions` | Step-by-step action timeline with pass/fail status |
| `e2e_get_action_detail` | Deep dive into one action: params, timing, error, DOM diff |
| `e2e_get_dom_snapshot` | Aria tree before/after any action |
| `e2e_get_dom_diff` | What changed in the DOM during an action |
| `e2e_find_elements` | Search DOM by role or text (cheaper than full snapshot) |
| `e2e_get_network` | Network requests with filtering and optional body inspection |
| `e2e_get_console` | Console output filtered by type |
| `e2e_get_test_source` | Test file with the failing test highlighted |

### Project Context
| Tool | What It Does |
|---|---|
| `e2e_get_context` | Load flows + page object index in one call |
| `e2e_scan_page_objects` | Discover all page object classes, methods, and getters |
| `e2e_get_app_flows` | Read stored application flows |
| `e2e_save_app_flow` | Save a confirmed user journey |
| `e2e_discover_flows` | Infer test flows from static analysis of spec files |
| `e2e_build_flows` | Auto-run uncovered tests and save their flows |

### Reporting & Triage
| Tool | What It Does |
|---|---|
| `e2e_generate_report` | Self-contained HTML or JSON report |
| `e2e_suggest_tests` | Test coverage gap analysis |
| `e2e_get_stats` | Suite health dashboard: pass rate trends, flaky scores, category breakdowns |
| `e2e_save_triage_run` | Save a categorized triage run for trend tracking |
| `e2e_get_triage_config` | Read triage settings (Jira config, flaky threshold) |

### Interactive Browser
| Tool | What It Does |
|---|---|
| `browser_navigate` | Open a URL (launches browser automatically) |
| `browser_navigate_back` | Go back in browser history |
| `browser_snapshot` | Capture ARIA accessibility tree with `[ref=X]` markers |
| `browser_click` | Click an element by ref |
| `browser_type` | Type into an input field, optionally submit |
| `browser_fill_form` | Fill multiple form fields in one call |
| `browser_select_option` | Select a dropdown option |
| `browser_press_key` | Press a key (Enter, Escape, Tab, etc.) |
| `browser_hover` | Hover over an element |
| `browser_take_screenshot` | Capture a PNG screenshot |
| `browser_set_headers` | Set custom HTTP headers (same-origin only for CORS safety) |
| `browser_close` | Close the browser |

---

## Token-Efficient by Design

LLM context is expensive. Every tool is designed to minimize token usage:

- **DOM snapshots** default to `interactiveOnly` mode — buttons, inputs, dropdowns only (~70% smaller)
- **Network bodies** excluded by default — opt in with `includeBody: true` only when needed
- **Depth limiting** — scan just the top 2 levels of the DOM tree for orientation, then drill deeper
- **Element search** — find a specific button or dropdown without loading the entire page tree
- **Failure report** — comprehensive overview in one call, so Claude doesn't need 5 separate tool calls to understand what happened

---

## Skills

### `/fix-e2e` — Investigate and Fix Failing Tests

A structured investigation workflow that walks Claude through diagnosing and fixing a test failure:

```
/playwright-autopilot:fix-e2e tests/checkout.spec.ts:42
```

Claude will:
1. Load your project context (page objects, stored flows)
2. Run the test with full capture
3. Read the failure report and screenshot
4. Examine DOM snapshots and network requests
5. Diagnose the root cause (locator changed? missing step? timing issue? data changed?)
6. Apply a minimal fix using your existing page objects
7. Re-run to verify the fix works

If Claude determines it's an **application bug** (not a test issue), it produces a Jira-ready bug report with evidence instead of modifying the test.

No `page.evaluate()` hacks. No `page.route()` workarounds. Just real UI interactions, the way a QA engineer would fix it.

### `/triage-e2e` — Full Suite Triage and Health Report

Run your entire test suite, classify every failure, and produce a management-ready report:

```
/playwright-autopilot:triage-e2e e2e
```

Claude will:
1. Run all tests (optionally filtered by project)
2. Classify each failure: **Known Issue**, **App Bug**, **Test Update**, **Flaky**, or **New Failure**
3. Cross-reference Jira for existing tickets (if Atlassian tools are available)
4. Create Jira tickets for new app bugs with evidence bundles
5. Save the triage run for trend tracking
6. Generate a scannable summary with category breakdown and suggested next steps

The triage history feeds into `e2e_get_stats`, so you can track pass rate trends, flaky test scores, and failure patterns over time.

---

## How It Works

Playwright Autopilot injects a lightweight capture hook into your Playwright test workers via `NODE_OPTIONS --require`. The hook instruments every browser action to capture:

- Aria snapshots before and after each action
- DOM diffs between snapshots
- Network requests and responses during each action
- Console messages
- Screenshots on failure

All data flows to an in-memory capture server and is accessible through the MCP tools. **Nothing is written to disk. Nothing is sent externally. Everything stays local.**

Works with **any Playwright project** — no fork required, no config changes, no test modifications.

---

## Installation

### As a Claude Code Plugin

```bash
/plugin marketplace add kaizen-yutani/playwright-autopilot
/plugin install playwright-autopilot@kaizen-yutani
```

### Manual Installation

Clone the repository and build:

```bash
git clone https://github.com/kaizen-yutani/playwright-autopilot.git
cd playwright-autopilot/plugin
./build.sh
```

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "playwright-autopilot": {
      "command": "node",
      "args": ["/path/to/plugin/server/mcp-server.js"]
    }
  }
}
```

---

## Requirements

- Node.js 20+
- Playwright (any recent version — works with npm upstream, no fork needed)
- Claude Code

---

## License

MIT

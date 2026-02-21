# Playwright Autopilot

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that debugs and fixes Playwright E2E tests autonomously. It runs your tests with full action capture — DOM snapshots, network requests, console output, screenshots — then investigates failures like a senior QA engineer and ships the fix.

https://github.com/kaizen-yutani/playwright-autopilot/raw/main/demo.mp4

## Quick Start

```bash
# Add the marketplace
/plugin marketplace add nikolarss0n/pw-autopilot

# Install the plugin
/plugin install playwright-autopilot@pw-autopilot
```

Then ask Claude to fix a failing test:

```
/playwright-autopilot:fix-e2e tests/checkout.spec.ts
```

Or just describe what you need — Claude will use the MCP tools automatically:

```
Fix all failing e2e tests in the "e2e" project
```

## What It Does

Every browser action during a test run is captured with:

- **Before/after DOM snapshots** — aria tree of the page before and after each click, fill, navigation
- **Network requests** — URL, method, status, timing, request/response bodies
- **Console output** — errors, warnings, logs tied to the action that produced them
- **Screenshots** — captured at point of failure

When a test fails, Claude doesn't guess — it reads the actual page state, checks for failed API calls, and traces the root cause through the action timeline.

## How It Works

### 1. Capture Hook

A lightweight CJS hook (`captureHook.cjs`) is injected via `NODE_OPTIONS --require` into Playwright's test worker processes. It monkey-patches `BrowserContext._initialize` to add an instrumentation listener that captures every browser action with full context. No modifications to Playwright's source code required — works with any Playwright installation.

### 2. MCP Tools

The plugin exposes 32 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) that Claude calls on-demand. This is token-efficient by design — instead of dumping entire traces into context, Claude pulls only what it needs:

**Test Execution & Debugging:**

| Tool | Purpose |
|------|---------|
| `e2e_list_projects` | List Playwright projects from config |
| `e2e_list_tests` | Discover test files and cases |
| `e2e_run_test` | Run tests with action capture, flaky detection (`retries`, `repeatEach`) |
| `e2e_get_failure_report` | Error + DOM + network + console summary |
| `e2e_get_evidence_bundle` | **All** failure evidence in one call — ready for Jira |
| `e2e_generate_report` | Self-contained HTML or JSON report file |
| `e2e_suggest_tests` | Test coverage gap analysis |
| `e2e_get_actions` | Step-by-step action timeline |
| `e2e_get_action_detail` | Deep dive into a single action |
| `e2e_get_dom_snapshot` | Aria tree before/after an action |
| `e2e_get_dom_diff` | What changed in the DOM |
| `e2e_get_network` | Network requests with filtering |
| `e2e_get_console` | Console output with filtering |
| `e2e_get_screenshot` | Failure screenshot as image |
| `e2e_get_test_source` | Test file with failing line highlighted |
| `e2e_find_elements` | Search DOM for specific elements |
| `e2e_scan_page_objects` | Index all page objects and methods |
| `e2e_get_app_flows` | Read stored application flows |
| `e2e_save_app_flow` | Save a verified user journey |
| `e2e_get_context` | Flows + page object index in one call |
| `e2e_discover_flows` | Auto-scan specs for draft flow map |

**Interactive Browser Exploration:**

| Tool | Purpose |
|------|---------|
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
| `browser_close` | Close the browser |

The `browser_*` tools launch a real Chrome instance and let Claude explore your application interactively — navigate pages, click elements, fill forms, and observe page state through ARIA snapshots. Each interaction returns timing, network requests, DOM changes, and an updated snapshot. Use this to understand an app before writing tests, debug UI issues visually, or verify fixes.

### 3. Flow Memory

After fixing (or verifying) a test, the plugin saves the confirmed application flow — the sequence of user interactions that make up the happy path. These flows persist in `.e2e-flows.json` and accumulate across sessions.

Next time that test breaks, Claude already knows the intended user journey and jumps straight to identifying what changed. The agent gets faster over time.

### 4. Flaky Detection

Two complementary modes for identifying flaky tests:

**`retries: N`** — Run the test N+1 times in separate Playwright processes. Each run gets its own `runId` with full action capture. Returns a verdict: `FLAKY`, `CONSISTENT PASS`, or `CONSISTENT FAIL`. Best for debugging with 2-3 retries.

```
e2e_run_test(location: "tests/checkout.spec.ts:15", retries: 2)
```

**`repeatEach: N`** — Native Playwright `--repeat-each`. All iterations in one process. Fast stress-test for confirming flakiness — use 30-100 for confidence.

```
e2e_run_test(location: "tests/checkout.spec.ts:15", repeatEach: 40)
```

### 5. Evidence Bundles

`e2e_get_evidence_bundle` packages **all** failure evidence into a single response — error, steps to reproduce, action timeline, failed network requests with bodies, console errors, DOM snapshot, and screenshots. Replaces calling 6+ tools separately.

Pass `outputFile: true` to write a markdown file to `test-reports/` for Jira attachments.

### 6. HTML Reports

Batch runs (no `location`) automatically generate a self-contained HTML report with:
- Pass/fail summary with status badges
- Collapsible per-test sections
- Action timelines, failed network requests, console errors
- DOM snapshots at failure points
- Screenshots as inline base64 images

Reports are written to `test-reports/report-<runId>.html`. You can also call `e2e_generate_report` manually for any run.

### 7. Coverage Analysis

`e2e_suggest_tests` scans your entire project to find coverage gaps:

1. **Untested page object methods** — methods in `.page.ts` / `.service.ts` files that no spec calls
2. **Missing flow variants** — flows with pre-conditions (e.g. "no draft exists") that lack a continuation variant
3. **Uncovered flow steps** — actions listed in confirmed flows that no spec exercises

### 8. Architecture Awareness

Before writing any fix, the plugin scans your project for page objects, service layers, and test fixtures. It follows your existing patterns:

- Uses your **Page Object Model** methods instead of writing raw Playwright calls
- Respects your **business/service layer** separation
- Uses `getByRole()`, `getByTestId()`, web-first assertions
- Produces **minimal diffs** — typically one or two lines added

## Debugging Philosophy

The plugin follows a strict diagnostic methodology:

**Think in user flows, not selectors.** Before touching code, it maps the intended user journey. When a step is missing — a dropdown never selected, a required field never filled — it finds the existing page object method and adds the call.

**Four root cause categories:**

1. **Missing test step** — the test skips a UI interaction the app requires
2. **Test code bug** — wrong selector, stale assertion, bad test data
3. **Application bug** — the app itself is broken (reported, not worked around)
4. **Dirty state** — leftovers from previous test runs interfering

**No hacks.** The plugin will never use `page.evaluate()`, `page.route()`, `page.addInitScript()`, or any JavaScript injection to work around a failing test. If the fix requires those, it's solving the wrong problem.

## Configuration

### Multi-project setup

If your Playwright project lives in a different directory than where Claude Code runs, set the `PW_PROJECT_DIR` environment variable in `.mcp.json`:

```json
{
  "mcpServers": {
    "playwright-autopilot": {
      "command": "node",
      "args": ["path/to/plugin/server/mcp-server.js"],
      "env": {
        "PW_PROJECT_DIR": "/path/to/your/playwright/project"
      }
    }
  }
}
```

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Playwright](https://playwright.dev/) test project
- Node.js 18+

## License

MIT

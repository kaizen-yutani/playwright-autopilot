# Playwright Autopilot

**Give Claude Code x-ray vision into your Playwright tests.**

Playwright Autopilot captures every action, DOM snapshot, screenshot, network request, and console message from your test runs — then exposes it all through 18 MCP tools so Claude can debug failures like a senior QA engineer.

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

---

## Tools Reference

### Test Execution
| Tool | What It Does |
|---|---|
| `e2e_list_tests` | Discover all tests with file paths and line numbers |
| `e2e_run_test` | Run a test with full action capture, returns a `runId` |

### Failure Investigation
| Tool | What It Does |
|---|---|
| `e2e_get_failure_report` | One-call failure overview: error, timeline, DOM, network, console |
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

---

## Token-Efficient by Design

LLM context is expensive. Every tool is designed to minimize token usage:

- **DOM snapshots** default to `interactiveOnly` mode — buttons, inputs, dropdowns only (~70% smaller)
- **Network bodies** excluded by default — opt in with `includeBody: true` only when needed
- **Depth limiting** — scan just the top 2 levels of the DOM tree for orientation, then drill deeper
- **Element search** — find a specific button or dropdown without loading the entire page tree
- **Failure report** — comprehensive overview in one call, so Claude doesn't need 5 separate tool calls to understand what happened

---

## The `/fix-e2e` Skill

A built-in Claude Code slash command that walks through a structured investigation workflow:

```
/fix-e2e tests/checkout.spec.ts:42
```

Claude will:
1. Load your project context (page objects, stored flows)
2. Run the test with full capture
3. Read the failure report and screenshot
4. Examine DOM snapshots and network requests
5. Diagnose the root cause (locator changed? missing step? timing issue? data changed?)
6. Apply a minimal fix using your existing page objects
7. Re-run to verify the fix works

No `page.evaluate()` hacks. No `page.route()` workarounds. Just real UI interactions, the way a QA engineer would fix it.

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
claude plugins add playwright-autopilot
```

### Manual Installation

Clone the repository and build:

```bash
git clone https://github.com/nicklaros/playwright-autopilot.git
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

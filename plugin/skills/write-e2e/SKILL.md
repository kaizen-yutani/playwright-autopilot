---
name: write-e2e
description: Write new Playwright E2E tests following project conventions, with POM/business-layer architecture, network-aware stability patterns, and quality validation.
argument-hint: <jira-ticket-or-feature-description>
---

# Write E2E Test — Structured Test Creation Workflow

You are a senior Playwright E2E test automation engineer. Your job is to write production-grade tests that are **stable**, **readable**, and **follow the project's existing conventions exactly**.

The user will provide: $ARGUMENTS

**You have MCP tools available** (`e2e_*` and `browser_*`) — use them instead of raw shell commands. The MCP server's built-in instructions contain best practices and prohibitions — follow them.

---

## ABSOLUTE RULES — memorize these before writing a single line

### Stability Rules
1. **After any action that triggers an API call, wait for a STABLE network response** — not every request, but the one that confirms the operation completed (e.g., the POST that creates the record, the GET that loads the list). Use `page.waitForResponse(resp => resp.url().includes('/api/...') && resp.status() === 200)`.
2. **For navigation, decide the right wait strategy:**
   - `page.waitForURL()` — when you know the target URL pattern
   - `page.waitForLoadState('domcontentloaded')` — when the page shell is enough
   - `page.waitForLoadState('networkidle')` — ONLY for initial page loads where you need all data fetched. NEVER use this after clicks or form submits — it's too slow and flaky.
3. **For element visibility, prefer `await expect(locator).toBeVisible()`** — Playwright auto-retries this. Use it BEFORE interacting with elements that may not be immediately present.
4. **Use `expect().toPass()` for assertions that need retry** — wrap the assertion in a callback: `await expect(async () => { await expect(locator).toHaveCount(5); }).toPass({ timeout: 10_000 });`. This retries the entire callback until it passes. Use it when the state is eventually consistent (e.g., waiting for a list to update after a create operation).
5. **NEVER use `page.waitForTimeout()`** — hardcoded waits are always wrong.
6. **NEVER use try/catch around Playwright actions** — Playwright has built-in retry and timeout. Catching errors hides real failures.

### Architecture Rules
7. **Three-layer architecture is MANDATORY** when the project follows POM patterns:
   - **Page Object (POM):** Locators and atomic page interactions
   - **Business Layer (Service/Actions):** Reusable multi-step flows
   - **Test Spec:** Orchestrates business-layer calls with assertions
8. **If the project has existing page objects, USE THEM.** Never duplicate locators or methods that already exist.
9. **If a page object method doesn't exist, CREATE IT** in the appropriate page object file — don't inline raw locators in the test.
10. **Accessible locators ONLY:** `getByRole()`, `getByLabel()`, `getByText()`, `getByTestId()`, `getByPlaceholder()`, `getByAltText()`. NEVER use `page.locator('.css')` or XPath.

### Prohibition Rules
11. **NEVER use `page.evaluate()`** to modify state, inject params, or manipulate the DOM.
12. **NEVER use `page.addInitScript()`** to patch browser APIs.
13. **NEVER use `page.route()`** to intercept or mock network requests (unless the test is explicitly a mock/stub test).
14. **NEVER monkey-patch `window.fetch`** or `XMLHttpRequest`.
15. **No `if/else` branching in test bodies** — each test is a single deterministic path. Different scenarios = different tests.
16. **No `console.log` in tests** — use assertions to verify state.

---

## STEP 0: UNDERSTAND THE REQUIREMENT

Parse $ARGUMENTS to understand what needs to be tested:

1. **If a Jira ticket is referenced** (e.g., "PROJ-123"):
   - Use Atlassian MCP tools (if available) to read the ticket: acceptance criteria, description, linked specs
   - Search Confluence for related specification documents
   - Extract: the user flow, expected behavior, edge cases, and test data requirements
   - The Jira ticket is the source of truth — the test must cover its acceptance criteria

2. **If a feature description is provided** (e.g., "write tests for checkout flow"):
   - Search for existing documentation about the feature
   - Note what the user has specified — flows, scenarios, validations to cover

3. **If a URL is provided:**
   - That's the entry point for exploration in STEP 2

**Output a brief summary** of what you're going to test (2-3 sentences). Confirm with the user if the scope is unclear.

## STEP 1: DISCOVER PROJECT CONVENTIONS (MANDATORY — before writing ANY code)

This step determines HOW you write the test. Skip nothing.

### 1a. Load project context
```
e2e_get_context  →  stored flows + page object index
e2e_list_projects  →  available Playwright projects
e2e_list_tests  →  existing test files
```

### 1b. Analyze existing test architecture

Use Glob and Grep to discover the project's conventions:

- **Page objects:** `*.page.ts`, `*.po.ts`, `pages/*.ts` — what naming convention? Class-based or function-based?
- **Business layer / services:** `*.service.ts`, `*.actions.ts`, `actions/*.ts`, `services/*.ts`
- **Factories / test data:** `*.factory.ts`, `factories/*.ts`, `data/*.ts`, `fixtures/*.ts`
- **Custom fixtures:** Look for `test.extend<{}>` patterns — does the project use fixture injection?
- **Helpers / components:** `*.component.ts`, `components/*.ts`, `helpers/*.ts`
- **Config:** Read `playwright.config.ts` for baseURL, projects, timeouts, global setup
- **Authentication:** Check for `storageState` in config, `globalSetup` files, or `auth.setup.ts` — how does this project handle login? If the project uses `storageState`, your test inherits auth automatically. If it uses a `beforeEach` login helper, reuse it. If no auth pattern exists and the flow requires login, create a `storageState`-based setup following Playwright docs.
- **API seeding:** Check if existing tests use `beforeEach` with `request.post()` / `request.delete()` to seed or clean up data before UI tests. If the flow requires pre-existing data (e.g., "edit an order" needs an order to exist), use the same pattern.

### 1c. Read 2-3 existing tests that are SIMILAR to what you're writing

This is the most important part of convention discovery:
- Look at imports — what do they bring in?
- Look at test structure — `describe` nesting, `beforeEach`/`afterEach` patterns, data setup
- Look at assertion patterns — what assertions does this project prefer?
- Look at how they wait for things — response patterns, visibility checks
- Look at naming — file names, test titles, describe labels

### 1d. Scan page objects for the relevant pages

Use `e2e_scan_page_objects` to get a full method inventory. Cross-reference against what you'll need for your test.

**Decision point:** After this step you know:
- [ ] File naming convention (e.g., `checkout.spec.ts` vs `checkout.test.ts`)
- [ ] Page object style (class-based POM vs functional)
- [ ] Whether a business layer exists and what it's called
- [ ] Whether factories/fixtures are used for test data
- [ ] The assertion and waiting patterns the project uses
- [ ] Which page object methods ALREADY EXIST for your flow
- [ ] Which page object methods you NEED TO CREATE

**If no conventions are detected** (greenfield project), use the default architecture:
- `pages/` folder with class-based Page Objects
- `services/` or `actions/` folder with business layer classes
- `tests/` folder with spec files
- Accessible locators, AAA pattern, one behavior per test

## STEP 2: EXPLORE THE APPLICATION (MANDATORY for new flows)

If the flow already has a stored app flow AND existing tests cover it, you may skip browser exploration. Otherwise:

### 2a. Navigate and snapshot
```
browser_navigate  →  open the target page
browser_snapshot  →  see ARIA tree with [ref=X] markers
browser_take_screenshot  →  visual reference
```

### 2b. Walk through the user flow step by step

For each step the user would take:
1. **Observe the page** — `browser_snapshot` to see all interactive elements
2. **Interact** — `browser_click` / `browser_type` / `browser_select_option` using refs
3. **Note the response** — each interaction returns network requests made and DOM changes
4. **Record what you learn:**
   - Which API endpoint was called? What method/status?
   - What URL did the page navigate to?
   - What elements appeared/disappeared?
   - Were there console errors?

### 2c. Build a mental model of the flow

After walking through, you should know:
- The exact sequence of user interactions
- Which API calls are STABLE anchors for `waitForResponse` (the main CRUD operations, not analytics/tracking)
- What the success state looks like (URL change, success message, list update)
- What validations exist (required fields, format checks)

### 2d. Close the browser when done exploring
```
browser_close
```

## STEP 3: PLAN THE TEST STRUCTURE

Before writing code, plan what you'll create:

### Files to create or modify:
```
1. Page Object(s): {path} — {new methods needed}
2. Business Layer: {path} — {new service methods}
3. Factory (if needed): {path} — {test data generation}
4. Test Spec: {path} — {test cases}
```

### Page Object methods needed:
For each page in the flow, list:
- Methods that ALREADY EXIST (from step 1d) — just reference them
- Methods that NEED TO BE CREATED — with locator strategy and what they do

### Waiting strategy per action:
For each action that triggers something async, plan the wait:
```
| Action              | Wait Strategy                                          |
|---------------------|--------------------------------------------------------|
| Click "Submit"      | waitForResponse('/api/orders', status 200)             |
| Navigate to /cart   | waitForURL('**/cart')                                  |
| Fill search input   | expect(resultsList).toBeVisible()                      |
| Delete item         | expect(itemRow).not.toBeVisible()                      |
```

Choose `waitForResponse` when: a specific API call confirms the operation succeeded.
Choose `waitForURL` when: navigation occurs after the action.
Choose `expect().toBeVisible()` when: no specific API call, but a UI element confirms the state.
Choose `expect().toPass()` when: the state is eventually consistent and needs polling — wrap in callback: `await expect(async () => { await expect(list).toHaveCount(3); }).toPass();`

### Test cases:
```
describe('Feature Name')
  test('should {happy path}')
  test('should {validation case}')     // if requested
  test('should {edge case}')           // if requested
```

**One test = one behavior.** Happy path is always the first test. Add validation and edge cases only if the requirement asks for them.

## STEP 4: WRITE THE CODE

Write files in this order — each layer builds on the previous:

### 4a. Page Objects (if new methods needed)

Add methods to EXISTING page object files. Only create a new file if no page object exists for that page.

```typescript
// Pattern: atomic interactions, one method per UI action
async selectCategory(category: string) {
  await this.categoryDropdown.click();
  await this.page.getByRole('option', { name: category }).click();
}
```

Rules for page objects:
- Locators in the constructor (or as readonly properties)
- Methods are atomic — one user interaction per method
- No assertions in page objects (assertions belong in the test)
- No business logic (multi-step flows belong in the business layer)
- Match the existing POM style exactly

### 4b. Business Layer (service / actions)

The business layer combines page object calls into meaningful user flows:

```typescript
// Pattern: multi-step user flows, readable as requirements
async createOrder(orderData: OrderData) {
  await this.orderPage.fillProductName(orderData.product);
  await this.orderPage.selectCategory(orderData.category);
  await this.orderPage.setQuantity(orderData.quantity);

  const responsePromise = this.page.waitForResponse(
    resp => resp.url().includes('/api/orders') && resp.request().method() === 'POST'
  );
  await this.orderPage.clickSubmit();
  await responsePromise;
}
```

Rules for business layer:
- **This is where `waitForResponse` calls go** — set up the promise BEFORE the triggering action, then await it AFTER
- CRITICAL: always `const responsePromise = page.waitForResponse(...)` BEFORE the click, then `await responsePromise` AFTER — otherwise the response may fire before you start listening
- Keep methods readable — someone reading the method name should understand the business action
- No assertions here (unless they verify a precondition)

### 4c. Factories / Test Data (if needed)

```typescript
// Pattern: generate valid test data, avoid hardcoded values where possible
export function createOrderData(overrides?: Partial<OrderData>): OrderData {
  return {
    product: 'Test Product',
    category: 'Electronics',
    quantity: 1,
    ...overrides,
  };
}
```

Only create factories when: tests need multiple variations of the same data structure, or when test data needs to be unique per run.

### 4d. Test Spec

```typescript
import { test, expect } from '@playwright/test';

test.describe('Order Creation', () => {
  test('should create a new order with valid data', async ({ page }) => {
    // Arrange
    const orderPage = new OrderPage(page);
    const orderService = new OrderService(page, orderPage);
    const orderData = createOrderData();

    // Act
    await orderService.navigateToOrderForm();
    await orderService.createOrder(orderData);

    // Assert
    await expect(page).toHaveURL(/.*\/orders\/\d+/);
    await expect(orderPage.successMessage).toBeVisible();
    await expect(orderPage.orderTitle).toHaveText(orderData.product);
  });
});
```

Rules for test specs:
- **AAA pattern:** Arrange (setup), Act (do the thing), Assert (verify)
- One `test()` = one behavior. Don't test multiple things in one test.
- Assertions use web-first assertions: `toBeVisible()`, `toHaveText()`, `toHaveURL()`, `toContainText()`
- Use `expect().toPass()` only when the assertion needs polling — always with callback: `await expect(async () => { ... }).toPass()`
- Wrap in `test.describe()` with a meaningful label
- If the project uses `beforeEach` for navigation or cleanup, follow that pattern

## STEP 5: RUN AND VALIDATE

### 5a. Run the test
```
e2e_run_test  →  with the test location (file:line)
```

### 5b. If it fails — diagnose and fix

Use the debugging tools (pass the `runId` from step 5a):
1. `e2e_get_failure_report` — quick overview of error, DOM, network, console
2. `e2e_get_dom_snapshot` with `"which": "both"` — ARIA tree before and after the failing action
3. `e2e_get_dom_diff` — what changed in the DOM between before/after (useful for spotting missing elements)
4. `e2e_get_network` — check if API calls succeeded (use `statusMin: 400` to filter errors)
5. `e2e_get_screenshot` — visual state at failure

Common issues when a new test fails:
- **Missing wait:** The action completed but the assertion ran too early → add `waitForResponse` or `expect().toBeVisible()` before the assertion
- **Wrong locator:** The element exists but your locator doesn't match → check DOM snapshot, fix locator
- **Missing step:** The flow requires an interaction you didn't add → check DOM for uninteracted elements
- **Dirty state:** Previous test data interferes → add cleanup in `beforeEach`

Fix one issue at a time, re-run, iterate. Do NOT try to fix everything at once.

### 5c. If it passes — run it again to confirm stability

Run the test a second time to make sure it's not flaky:
```
e2e_run_test  →  same test location
```

If it's flaky (passes sometimes, fails sometimes), investigate timing issues:
- Add `waitForResponse` where you relied on implicit timing
- Add `await expect(element).toBeVisible()` before interactions with slow-loading elements
- Use `await expect(async () => { await expect(locator).toHaveText('Done'); }).toPass({ timeout: 10_000 });` for eventually-consistent state

## STEP 6: QUALITY CHECK

Validate the written test against these quality gates:

| # | Rule | Check |
|---|------|-------|
| 1 | Accessible locators only | No `page.locator('.css')`, no XPath, no `$` |
| 2 | No hardcoded waits | No `waitForTimeout`, no `setTimeout` |
| 3 | No if/else in test body | Tests are deterministic paths, not conditional logic |
| 4 | Has meaningful assertions | At least one `expect()` with `toBe`/`toHave`/`toContain`/`toBeVisible` |
| 5 | AAA pattern | Setup → Action → Verify clearly separated |
| 6 | No console.log | Tests don't log — they assert |
| 7 | No page.evaluate | No JavaScript injection to work around missing UI steps |
| 8 | No try/catch | No error suppression around Playwright actions |
| 9 | Network waits where needed | Actions that trigger API calls have `waitForResponse` |
| 10 | Matches project conventions | Same naming, same imports, same patterns as existing tests |

If any rule fails, fix the code before declaring done.

## STEP 7: SAVE THE FLOW

The test pass in STEP 5 will **auto-save** the flow via `e2e_run_test`. Enrich it with `e2e_save_app_flow` if you discovered:
- `pre_conditions` — what state must exist before this test (e.g., "user logged in", "no pending orders")
- `notes` — gotchas, edge cases, timing considerations you found during development
- `related_flows` — link to variant flows using the naming convention:
  - `checkout` — the clean-start happy path (pre_condition: "no draft exists")
  - `checkout--continue-draft` — tests resuming a partial/dirty state
  - `checkout--validation` — tests form validation errors

**If the flow you wrote creates persistent state** (e.g., a draft, an order, a session) that could interfere with future runs, document the cleanup requirement in `pre_conditions` and consider whether a `--continue-draft` variant flow is needed.

## OUTPUT FORMAT

When done, present:

1. **What was created** — list of files created/modified with brief descriptions
2. **Test summary** — the test cases and what they verify
3. **Architecture decisions** — why you chose certain waiting strategies, what page object methods you reused vs created
4. **Quality check result** — confirm all 10 rules pass
5. **Run result** — confirm the test passes (include the runId)

Keep it concise. The code speaks for itself.

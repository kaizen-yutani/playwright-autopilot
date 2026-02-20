/**
 * Capture Hook
 *
 * CommonJS module that gets loaded via NODE_OPTIONS --require to enable action capture.
 * Two capture mechanisms:
 * 1. BrowserContext patching - for UI tests (captures actions, network, console)
 * 2. HTTP interception - for API tests (captures outgoing HTTP requests)
 *
 * Uses Playwright's internal instrumentation API to capture actions without
 * requiring any modifications to Playwright itself.
 *
 * Environment variables:
 * - PW_CAPTURE_ENDPOINT: HTTP endpoint to send captures to
 */

const endpoint = process.env.PW_CAPTURE_ENDPOINT;

// Methods that are read-only getters — don't represent user actions
const readOnlyMethods = new Set([
  'title', 'url', 'content', 'viewportSize', 'opener',
  'querySelector', 'querySelectorAll', '$', '$$',
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByAltText', 'getByTitle', 'getByTestId', 'frameLocator',
  'textContent', 'innerText', 'innerHTML', 'getAttribute',
  'inputValue', 'isChecked', 'isDisabled', 'isEditable',
  'isEnabled', 'isHidden', 'isVisible', 'count', 'all',
  'first', 'last', 'nth', 'boundingBox', 'allTextContents',
  'allInnerTexts',
  'ownerFrame', 'contentFrame',
  'evaluate', 'evaluateHandle', 'getProperties', 'getProperty', 'jsonValue',
  'evaluateExpression', 'evaluateExpressionHandle',
  'waitForSelector', 'waitForFunction', 'waitForLoadState', 'waitForURL',
  'waitForTimeout', 'waitForEvent',
  'childFrames', 'parentFrame', 'name', 'isDetached',
]);

// Types filtered entirely (internal infrastructure)
const filteredTypes = new Set([
  'Tracing', 'Artifact', 'JsonPipe', 'LocalUtils',
]);

function shouldCapture(metadata) {
  if (metadata.internal) return false;
  if (filteredTypes.has(metadata.type)) return false;
  if (readOnlyMethods.has(metadata.method)) return false;
  return true;
}

if (endpoint) {
  // === 1. BrowserContext patching for UI tests ===
  let patched = false;

  function tryPatch() {
    if (patched) return true;

    for (const key of Object.keys(require.cache)) {
      if (key.includes('browserContext') && key.endsWith('.js')) {
        try {
          const mod = require.cache[key];
          if (mod && mod.exports) {
            const BrowserContext = mod.exports.BrowserContext;
            if (BrowserContext &&
                typeof BrowserContext === 'function' &&
                !BrowserContext._captureHookPatched &&
                BrowserContext.Events) {
              patched = true;
              BrowserContext._captureHookPatched = true;
              patchBrowserContext(BrowserContext);
              return true;
            }
          }
        } catch (e) {
          // Module not ready
        }
      }
    }
    return false;
  }

  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    if (tryPatch() || attempts >= 1000) {
      clearInterval(pollInterval);
    }
  }, 5);

  // === 2. HTTP interception for API tests ===
  installHttpInterceptor();
}

/**
 * Monkey-patch BrowserContext._initialize to attach instrumentation
 * on every new context. Works with any Playwright version.
 */
function patchBrowserContext(BrowserContext) {
  const origInitialize = BrowserContext.prototype._initialize;
  BrowserContext.prototype._initialize = async function() {
    const result = await origInitialize.call(this);
    installContextCapture(this, BrowserContext);
    return result;
  };
}

// Actions that don't have a meaningful page DOM
const noSnapshotActions = new Set([
  'BrowserContext.newPage', 'BrowserContext.close',
  'Route.abort', 'Route.fulfill', 'Route.continue',
  'BrowserContext.cookies', 'BrowserContext.addCookies', 'BrowserContext.clearCookies',
]);

/**
 * Capture an aria snapshot from a page using internal Playwright APIs.
 * Returns the snapshot string or undefined if capture fails.
 */
async function captureAriaSnapshot(page) {
  if (!page) return undefined;
  try {
    const frame = page.mainFrame();
    const utilityContext = await Promise.race([
      frame._utilityContext(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    const injectedScript = await utilityContext.injectedScript();

    let snapshot;
    try {
      snapshot = await injectedScript.evaluate((injected) => {
        const body = injected.document.body;
        if (!body) return null;
        return injected.ariaSnapshot(body, { forAI: true, refPrefix: 's' });
      });
    } catch {
      return undefined;
    }
    return typeof snapshot === 'string' ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compute diff between two aria snapshots using line-based comparison.
 * Works without [ref=...] annotations (which forAI mode suppresses).
 */
function computeSnapshotDiff(before, after) {
  if (!before || !after) return undefined;

  const beforeLines = before.split('\n').map(l => l.trimEnd()).filter(Boolean);
  const afterLines = after.split('\n').map(l => l.trimEnd()).filter(Boolean);

  // Build multiset (line -> count) for each snapshot
  const beforeCounts = new Map();
  for (const line of beforeLines)
    beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);

  const afterCounts = new Map();
  for (const line of afterLines)
    afterCounts.set(line, (afterCounts.get(line) || 0) + 1);

  const added = [];
  const removed = [];

  // Lines with more occurrences in after = added
  for (const [line, count] of afterCounts) {
    const diff = count - (beforeCounts.get(line) || 0);
    for (let i = 0; i < diff; i++) added.push(line.trim());
  }

  // Lines with more occurrences in before = removed
  for (const [line, count] of beforeCounts) {
    const diff = count - (afterCounts.get(line) || 0);
    for (let i = 0; i < diff; i++) removed.push(line.trim());
  }

  // Cap output to avoid huge diffs on full page navigations
  const maxItems = 30;
  const addedTrimmed = added.slice(0, maxItems);
  const removedTrimmed = removed.slice(0, maxItems);

  const summaryParts = [];
  if (added.length > 0) summaryParts.push(`${added.length} added`);
  if (removed.length > 0) summaryParts.push(`${removed.length} removed`);

  return {
    added: addedTrimmed,
    removed: removedTrimmed,
    changed: [],
    summary: summaryParts.length > 0 ? summaryParts.join(', ') : 'no changes',
  };
}

/**
 * Install action & network capture on a single BrowserContext instance
 * using the internal instrumentation API.
 */
function installContextCapture(context, BrowserContext) {
  const pendingActions = new Map();

  const listener = {
    async onBeforeCall(sdkObject, metadata) {
      if (!shouldCapture(metadata)) return;

      const actionKey = `${metadata.type}.${metadata.method}`;
      const page = sdkObject.attribution?.page;

      // Capture snapshot before the action (skip non-page actions)
      let snapshotBefore;
      if (page && !noSnapshotActions.has(actionKey)) {
        snapshotBefore = await captureAriaSnapshot(page);
      }

      pendingActions.set(metadata.id, {
        metadata,
        networkRequests: new Map(),
        completedRequests: [],
        consoleMessages: [],
        snapshotBefore,
      });

      const actionName = metadata.title || actionKey;
      sendCapture({
        type: 'action:start',
        sessionId: process.env.PW_CAPTURE_SESSION || 'default',
        timestamp: Date.now(),
        data: {
          callId: metadata.id,
          type: metadata.type,
          method: metadata.method,
          title: actionName,
          startTime: metadata.startTime,
        },
      }).catch(() => {});
    },

    async onAfterCall(sdkObject, metadata) {
      const pending = pendingActions.get(metadata.id);
      if (!pending) return;
      pendingActions.delete(metadata.id);

      // Capture snapshot after the action
      const actionKey = `${metadata.type}.${metadata.method}`;
      const page = sdkObject.attribution?.page;
      let snapshotAfter;
      if (page && !noSnapshotActions.has(actionKey)) {
        snapshotAfter = await captureAriaSnapshot(page);
      }

      // Merge completed + still-pending network requests
      const allRequests = [...pending.completedRequests];
      const now = Date.now();
      for (const [request, info] of pending.networkRequests.entries()) {
        try {
          allRequests.push({
            method: request.method(),
            url: request.url(),
            status: null,
            statusText: 'pending',
            startTime: info.startTime,
            endTime: now,
            durationMs: now - info.startTime,
            resourceType: request.resourceType(),
          });
        } catch {}
      }

      const actionName = metadata.title || actionKey;
      const capture = {
        type: metadata.type,
        method: metadata.method,
        title: actionName,
        params: metadata.params,
        timing: {
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          durationMs: metadata.endTime - metadata.startTime,
        },
        network: {
          requests: allRequests,
          summary: formatNetworkSummary(allRequests),
        },
        console: pending.consoleMessages,
        snapshot: {
          before: pending.snapshotBefore,
          after: snapshotAfter,
          diff: computeSnapshotDiff(pending.snapshotBefore, snapshotAfter),
        },
        pageUrl: page ? safeGetUrl(page) : undefined,
      };

      if (metadata.error) {
        capture.error = {
          message: metadata.error.error?.message || metadata.error.message || 'Unknown error',
        };
      }

      sendCapture({
        type: 'action:capture',
        sessionId: process.env.PW_CAPTURE_SESSION || 'default',
        timestamp: Date.now(),
        data: capture,
      }).catch(() => {});
    },
  };

  context.instrumentation.addListener(listener, context);

  // Network event listeners
  const Events = BrowserContext.Events;

  context.on(Events.Request, (request) => {
    try {
      const postData = request.postDataBuffer()?.toString('utf-8')?.slice(0, 2000);
      for (const pending of pendingActions.values()) {
        pending.networkRequests.set(request, { startTime: Date.now(), postData });
      }
    } catch {}
  });

  context.on(Events.Response, (response) => {
    try {
      const request = response.request();
      // Capture status from Response event (since _existingResponse may not work)
      for (const pending of pendingActions.values()) {
        const info = pending.networkRequests.get(request);
        if (info) {
          info.status = response.status();
          info.statusText = response.statusText();
        }
      }
      const contentType = (response.headers()['content-type'] || '');
      const isTextual = contentType.includes('json') ||
                        contentType.includes('text') ||
                        contentType.includes('javascript') ||
                        contentType.includes('xml');
      if (isTextual) {
        response.body().then(buffer => {
          const body = buffer.toString('utf-8').slice(0, 5000);
          for (const pending of pendingActions.values()) {
            const info = pending.networkRequests.get(request);
            if (info) info.responseBody = body;
          }
        }).catch(() => {});
      }
    } catch {}
  });

  context.on(Events.RequestFinished, (request) => {
    completeRequest(pendingActions, request, false);
  });

  context.on(Events.RequestFailed, (request) => {
    completeRequest(pendingActions, request, true);
  });

  context.on(Events.Console, (message) => {
    try {
      const msg = {
        type: message.type(),
        text: message.text(),
        timestamp: Date.now(),
        location: message.location(),
      };
      for (const pending of pendingActions.values()) {
        pending.consoleMessages.push(msg);
      }
    } catch {}
  });
}

function completeRequest(pendingActions, request, failed) {
  const now = Date.now();
  for (const pending of pendingActions.values()) {
    const info = pending.networkRequests.get(request);
    if (!info) continue;
    pending.networkRequests.delete(request);

    try {
      const response = request._existingResponse?.() ?? null;
      pending.completedRequests.push({
        method: request.method(),
        url: request.url(),
        status: failed ? 0 : (response?.status() ?? info.status ?? null),
        statusText: failed ? 'failed' : (response?.statusText() ?? info.statusText ?? ''),
        startTime: info.startTime,
        endTime: now,
        durationMs: now - info.startTime,
        resourceType: request.resourceType(),
        responseBody: info.responseBody,
        requestPostData: info.postData,
      });
    } catch {}
  }
}

function safeGetUrl(page) {
  try { return page.mainFrame().url(); } catch { return undefined; }
}

function formatNetworkSummary(requests) {
  if (requests.length === 0) return '';
  return requests.map(r => {
    try {
      const pathname = new URL(r.url).pathname;
      const status = r.status !== null ? ` (${r.status})` : ' (pending)';
      return `${r.method} ${pathname}${status}`;
    } catch {
      return `${r.method} ${r.url}`;
    }
  }).join(', ');
}

/**
 * Install HTTP interceptor to capture outgoing requests for API tests.
 * Patches http.request and https.request at the Node.js level.
 */
function installHttpInterceptor() {
  const http = require('http');
  const https = require('https');
  const captureUrl = new URL(endpoint);
  // Build the exact origin to skip — only skip requests to the capture server itself
  const captureOrigin = `${captureUrl.hostname}:${captureUrl.port}`;

  function wrapRequest(originalRequest, protocol) {
    return function patchedRequest(...args) {
      const req = originalRequest.apply(this, args);

      // Extract request info
      let url = '';
      let method = 'GET';
      let postData = null;

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = args[0].toString();
        if (typeof args[1] === 'object' && args[1] !== null && !args[1].on) {
          method = args[1].method || 'GET';
        }
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        const opts = args[0];
        method = opts.method || 'GET';
        const host = opts.hostname || opts.host || 'localhost';
        const port = opts.port ? `:${opts.port}` : '';
        const path = opts.path || '/';
        url = `${protocol}//${host}${port}${path}`;
      }

      // Only skip requests to the capture server itself (not all localhost traffic)
      if (!url || url.includes(captureOrigin)) {
        return req;
      }

      const startTime = Date.now();

      // Capture POST data
      const originalWrite = req.write;
      req.write = function(data, ...rest) {
        if (data && !postData) {
          postData = typeof data === 'string' ? data : data.toString('utf8').substring(0, 2000);
        }
        return originalWrite.call(this, data, ...rest);
      };

      req.on('response', (res) => {
        const chunks = [];

        // Send action:start immediately so the progress indicator works
        const parsedUrl = safeParseUrl(url);
        const shortPath = parsedUrl ? parsedUrl.pathname : url;
        const title = `${method} ${shortPath}`;

        sendCapture({
          type: 'action:start',
          sessionId: process.env.PW_CAPTURE_SESSION || 'default',
          timestamp: startTime,
          data: {
            type: 'APIRequestContext',
            method: 'fetch',
            title: title,
            startTime: startTime,
          },
        }).catch(() => {});

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const endTime = Date.now();
          const durationMs = endTime - startTime;

          // Decompress and decode response body
          let body = '';
          try {
            const rawBuffer = Buffer.concat(chunks);
            const encoding = res.headers['content-encoding'];
            if (encoding === 'gzip' || encoding === 'x-gzip') {
              body = require('zlib').gunzipSync(rawBuffer).toString('utf8');
            } else if (encoding === 'deflate') {
              body = require('zlib').inflateSync(rawBuffer).toString('utf8');
            } else if (encoding === 'br') {
              body = require('zlib').brotliDecompressSync(rawBuffer).toString('utf8');
            } else {
              body = rawBuffer.toString('utf8');
            }
          } catch {
            body = Buffer.concat(chunks).toString('utf8');
          }

          // Truncate very large bodies (keep enough for JSON structure)
          if (body.length > 10000) {
            body = body.substring(0, 10000);
          }

          sendCapture({
            type: 'action:capture',
            sessionId: process.env.PW_CAPTURE_SESSION || 'default',
            timestamp: endTime,
            data: {
              type: 'APIRequestContext',
              method: 'fetch',
              title: title,
              timing: { startTime, endTime, durationMs },
              network: {
                requests: [{
                  method: method,
                  url: url,
                  status: res.statusCode,
                  statusText: res.statusMessage || '',
                  durationMs: durationMs,
                  startTime: startTime,
                  endTime: endTime,
                  resourceType: 'fetch',
                  responseBody: body,
                  requestPostData: postData || undefined,
                }],
                summary: `${res.statusCode} ${method} ${shortPath} (${durationMs}ms)`,
              },
              console: [],
              snapshot: {},
            },
          }).catch(() => {});
        });
      });

      req.on('error', (err) => {
        const endTime = Date.now();
        sendCapture({
          type: 'action:capture',
          sessionId: process.env.PW_CAPTURE_SESSION || 'default',
          timestamp: endTime,
          data: {
            type: 'APIRequestContext',
            method: 'fetch',
            title: `${method} ${url}`,
            timing: { startTime, endTime, durationMs: endTime - startTime },
            network: {
              requests: [{
                method: method,
                url: url,
                status: null,
                durationMs: endTime - startTime,
                startTime: startTime,
                endTime: endTime,
                resourceType: 'fetch',
              }],
              summary: `FAILED ${method} ${url}`,
            },
            console: [],
            snapshot: {},
            error: { message: err.message },
          },
        }).catch(() => {});
      });

      return req;
    };
  }

  http.request = wrapRequest(http.request, 'http:');
  https.request = wrapRequest(https.request, 'https:');

  // Also patch http.get and https.get
  const originalHttpGet = http.get;
  http.get = function(...args) {
    const req = http.request(...args);
    req.end();
    return req;
  };

  const originalHttpsGet = https.get;
  https.get = function(...args) {
    const req = https.request(...args);
    req.end();
    return req;
  };
}

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function sendCapture(event) {
  if (!endpoint) return;

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
    });
  } catch {
    // Ignore failures
  }
}

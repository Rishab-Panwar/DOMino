/**
 * DOM Action Executor — Phase 9
 *
 * Executes structured DOM actions (click, type, navigate, extract, scroll)
 * with a strict allowlist, selector sanitization, and rate limiting.
 */
import { MIN_ACTION_INTERVAL_MS } from '../shared/constants';
import { getElementByIndex } from './dom-scraper';

export interface ActionRequest {
  actionType: string;
  index?: number;          // primary: handle from the indexed element list
  selector?: string;       // fallback: CSS selector
  value?: string;
  url?: string;
  direction?: string;
  description: string;
}

export interface ActionResult {
  ok: boolean;
  summary: string;
  error?: string;
  extractedText?: string;
}

// ─── Allowlist ────────────────────────────────────────────────────────────────

const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'extract', 'scroll', 'select', 'key']);

// ─── Element highlighting ─────────────────────────────────────────────────────

async function highlightElement(el: Element): Promise<void> {
  const htmlEl = el as HTMLElement;
  const originalOutline = htmlEl.style.outline;
  const originalTransition = htmlEl.style.transition;
  htmlEl.style.transition = 'outline 0.15s ease';
  htmlEl.style.outline = '2px solid rgba(48, 209, 88, 0.9)';
  htmlEl.style.outlineOffset = '2px';
  await new Promise(r => setTimeout(r, 150));
  htmlEl.style.outline = originalOutline;
  htmlEl.style.transition = originalTransition;
  htmlEl.style.outlineOffset = '';
}

async function scrollIntoViewAndRetry(selector: string): Promise<Element | null> {
  const el = document.querySelector(selector);
  if (!el) return null;
  (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 500));
  return document.querySelector(selector);
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

let lastActionTime = 0;
let actionQueue: Promise<void> = Promise.resolve();

// Remember the last field we typed into, so a follow-up "key Enter" lands on it
// even after the page was re-observed between steps (focus may have been lost).
let lastTypedElement: Element | null = null;

/** Lowercase tag name — safe across iframes/realms where `instanceof HTML*` fails. */
function tagOf(el: Element | null | undefined): string {
  return (el?.tagName || '').toLowerCase();
}

async function enforceRateLimit(): Promise<void> {
  return new Promise<void>((resolve) => {
    actionQueue = actionQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - lastActionTime;
      if (elapsed < MIN_ACTION_INTERVAL_MS) {
        await new Promise<void>((r) => setTimeout(r, MIN_ACTION_INTERVAL_MS - elapsed));
      }
      lastActionTime = Date.now();
      resolve();
    });
  });
}

// ─── Selector sanitizer ───────────────────────────────────────────────────────

const DANGEROUS_SELECTOR_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /on\w+=\s*['"]/i, // onclick=', onerror="
  /`/,
];

function sanitizeSelector(selector: string): { ok: boolean; error?: string } {
  for (const pattern of DANGEROUS_SELECTOR_PATTERNS) {
    if (pattern.test(selector)) {
      return { ok: false, error: `Dangerous selector pattern detected: ${pattern}` };
    }
  }
  // Test that the selector is syntactically valid
  try {
    document.querySelector(selector);
  } catch (e) {
    return { ok: false, error: `Invalid selector syntax: ${(e as Error).message}` };
  }
  return { ok: true };
}

function queryElement(selector: string): { el: Element | null; error?: string } {
  const sanitized = sanitizeSelector(selector);
  if (!sanitized.ok) {
    return { el: null, error: sanitized.error };
  }
  try {
    const el = document.querySelector(selector);
    return { el };
  } catch (e) {
    return { el: null, error: (e as Error).message };
  }
}

/**
 * Resolve the target element for an action. Prefers the indexed handle from the
 * last scrape (reliable, no selector guessing); falls back to a CSS selector.
 */
async function resolveElement(req: ActionRequest): Promise<{ el: Element | null; ref: string; error?: string }> {
  // 1. Index handle (primary)
  if (typeof req.index === 'number' && !Number.isNaN(req.index)) {
    const el = getElementByIndex(req.index);
    if (el) return { el, ref: `[${req.index}]` };
    // Index went stale (DOM changed) — fall through to selector if we have one.
    if (!req.selector) {
      return { el: null, ref: `[${req.index}]`, error: `Element [${req.index}] is no longer on the page — re-observe and use a current index` };
    }
  }

  // 2. CSS selector (fallback)
  if (req.selector) {
    let { el, error } = queryElement(req.selector);
    if (error) return { el: null, ref: req.selector, error };
    if (!el) {
      el = await scrollIntoViewAndRetry(req.selector);
      if (!el) return { el: null, ref: req.selector, error: `Element not found: ${req.selector}` };
    }
    return { el, ref: req.selector };
  }

  return { el: null, ref: 'none', error: 'No element index or selector provided' };
}

function labelFor(el: Element, ref: string): string {
  return el.textContent?.trim().slice(0, 50) || el.getAttribute('aria-label')?.slice(0, 50) || ref;
}

// ─── Action implementations ───────────────────────────────────────────────────

async function actionClick(el: Element, ref: string): Promise<ActionResult> {
  (el as HTMLElement).scrollIntoView({ block: 'center' });
  await highlightElement(el);

  try {
    (el as HTMLElement).click();
  } catch {
    // Fallback: dispatch a full mouse sequence (some widgets ignore .click())
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  return { ok: true, summary: `Clicked '${labelFor(el, ref)}'` };
}

async function actionTypeText(el: Element, ref: string, value: string): Promise<ActionResult> {
  (el as HTMLElement).scrollIntoView({ block: 'center' });
  await highlightElement(el);
  lastTypedElement = el;

  // Resolve the real editable node. The DOM scraper often hands us a wrapper
  // (e.g. Gmail's body) rather than the editable element itself.
  let target = el as HTMLElement;
  // tagName-based detection — robust across iframes/realms (instanceof HTML*Element
  // fails there) and stable under tests.
  const isFormField = tagOf(target) === 'input' || tagOf(target) === 'textarea';
  if (!isFormField && !target.isContentEditable) {
    const inner = target.querySelector?.('[contenteditable="true"], [role="textbox"], input, textarea') as HTMLElement | null;
    const outer = target.closest?.('[contenteditable="true"], [role="textbox"]') as HTMLElement | null;
    if (inner || outer) target = (inner || outer) as HTMLElement;
  }

  const targetTag = tagOf(target);
  const isInputLike = targetTag === 'input' || targetTag === 'textarea';

  // Contenteditable / rich text editors (Gmail body, Notion, etc.) — no .value;
  // insert via the editing API instead, which also fires the events frameworks watch.
  if (!isInputLike && (target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox')) {
    target.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    sel?.removeAllRanges();
    sel?.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      target.textContent = value;
    }
    target.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, summary: `Typed '${value.slice(0, 30)}' into ${ref}` };
  }

  const input = target as HTMLInputElement;
  input.focus();
  // Native setter works with React/Vue controlled inputs — but is only valid on
  // real <input>/<textarea>. Calling it on anything else throws "Illegal invocation".
  if (isInputLike) {
    const proto = targetTag === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    try {
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
      } else {
        input.value = value;
      }
    } catch {
      // Native setter rejected this element (e.g. a mock or proxied node) — set directly.
      input.value = value;
    }
  } else {
    return { ok: false, summary: '', error: `Element is not typable: ${ref}` };
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Auto-submit search boxes by pressing Enter
  const isSearch = input.type === 'search' ||
    input.getAttribute('role') === 'searchbox' ||
    input.getAttribute('aria-label')?.toLowerCase().includes('search') ||
    input.name?.toLowerCase().includes('search') ||
    input.name?.toLowerCase().includes('keyword') ||
    !!input.closest('form[role="search"]');

  if (isSearch && value.length > 0) {
    // Brief delay for autocomplete to settle, then submit
    await new Promise(r => setTimeout(r, 300));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    // Fallback: submit the form directly
    const form = input.closest('form');
    if (form) {
      try { form.requestSubmit(); } catch { form.submit(); }
    }
    return { ok: true, summary: `Typed '${value.slice(0, 30)}' and searched` };
  }

  return { ok: true, summary: `Typed '${value.slice(0, 30)}' into ${ref}` };
}

async function actionNavigate(url: string): Promise<ActionResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, summary: '', error: `Unsafe URL scheme — only http:// and https:// are allowed: ${url}` };
  }
  window.location.href = url;
  return { ok: true, summary: `Navigating to ${url}` };
}

async function actionExtract(el: Element, ref: string): Promise<ActionResult> {
  const text = el.textContent?.trim() ?? '';
  return {
    ok: true,
    summary: `Extracted text from ${ref}: '${text.slice(0, 100)}'`,
    extractedText: text,
  };
}

/** Select an option in a <select> (or ARIA combobox) by visible text or value. */
async function actionSelect(el: Element, ref: string, value: string): Promise<ActionResult> {
  await highlightElement(el);
  if (tagOf(el) === 'select') {
    const selectEl = el as HTMLSelectElement;
    const wanted = value.trim().toLowerCase();
    const opts = Array.from(selectEl.options);
    const match = opts.find(o => o.text.trim().toLowerCase() === wanted)
      || opts.find(o => o.value.trim().toLowerCase() === wanted)
      || opts.find(o => o.text.trim().toLowerCase().includes(wanted));
    if (!match) return { ok: false, summary: '', error: `No option matching '${value}' in ${ref}` };
    selectEl.value = match.value;
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, summary: `Selected '${match.text.trim().slice(0, 40)}'` };
  }
  // Non-native dropdown — best effort: click to open it; the agent picks the
  // option on the next observation.
  try { (el as HTMLElement).click(); } catch { /* ignore */ }
  return { ok: true, summary: `Opened dropdown '${labelFor(el, ref)}' — choose the option next` };
}

/** Press a key on an element (or the active element). */
async function actionKey(el: Element | null, key: string): Promise<ActionResult> {
  // Prefer an explicit element, else the focused element, else the last field we
  // typed into (handles "type then press Enter" across a re-observation).
  const active = document.activeElement;
  const activeIsEditable = active && (tagOf(active) === 'input' || tagOf(active) === 'textarea' || (active as HTMLElement).isContentEditable);
  const fallback = activeIsEditable ? active : (lastTypedElement && lastTypedElement.isConnected ? lastTypedElement : active);
  const target = (el as HTMLElement) || (fallback as HTMLElement) || document.body;
  const k = key.trim();
  const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
    enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  };
  const def = keyMap[k.toLowerCase()];
  if (!def) return { ok: false, summary: '', error: `Unsupported key: ${key}` };
  target.focus?.();
  for (const type of ['keydown', 'keypress', 'keyup']) {
    target.dispatchEvent(new KeyboardEvent(type, { ...def, bubbles: true, cancelable: true }));
  }
  // Enter on a form field submits the surrounding form as a fallback.
  if (def.key === 'Enter') {
    const form = (target as HTMLElement).closest?.('form');
    if (form) { try { form.requestSubmit(); } catch { /* ignore */ } }
  }
  return { ok: true, summary: `Pressed ${def.key}` };
}

async function actionScroll(selectorOrDirection: string): Promise<ActionResult> {
  const dir = selectorOrDirection.toLowerCase().trim();

  // Minimum delay after scroll to let the animation complete before DOM observation
  const SCROLL_SETTLE_MS = 600;

  // Handle direction-based scrolling
  if (dir === 'up') {
    window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled up one screen' };
  }
  if (dir === 'down') {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled down one screen' };
  }
  if (dir === 'top' || dir === 'page top' || dir === 'start') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled to top of page' };
  }
  if (dir === 'bottom' || dir === 'page bottom' || dir === 'end' || dir.includes('bottom')) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled to bottom of page' };
  }

  // Try as CSS selector — scroll element into view
  let { el, error } = queryElement(selectorOrDirection);
  if (error) return { ok: false, summary: '', error };

  if (!el) {
    // Retry: scroll into view and re-query
    el = await scrollIntoViewAndRetry(selectorOrDirection);
    if (!el) return { ok: false, summary: '', error: `Element not found: ${selectorOrDirection}` };
  }

  (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { ok: true, summary: `Scrolled to ${selectorOrDirection}` };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function executeAction(request: ActionRequest): Promise<ActionResult> {
  const { actionType, value, url, direction } = request;

  // 1. Allowlist check
  if (!ALLOWED_ACTIONS.has(actionType)) {
    return { ok: false, summary: '', error: `Unknown action type: ${actionType}` };
  }

  // 2. Rate limiting
  await enforceRateLimit();

  // 3. Dispatch to implementation
  try {
    switch (actionType) {
      case 'click': {
        const { el, ref, error } = await resolveElement(request);
        if (!el) return { ok: false, summary: '', error: error || 'element not found' };
        return await actionClick(el, ref);
      }

      case 'type': {
        const { el, ref, error } = await resolveElement(request);
        if (!el) return { ok: false, summary: '', error: error || 'element not found' };
        return await actionTypeText(el, ref, value ?? '');
      }

      case 'select': {
        const { el, ref, error } = await resolveElement(request);
        if (!el) return { ok: false, summary: '', error: error || 'element not found' };
        return await actionSelect(el, ref, value ?? '');
      }

      case 'extract': {
        const { el, ref, error } = await resolveElement(request);
        if (!el) return { ok: false, summary: '', error: error || 'element not found' };
        return await actionExtract(el, ref);
      }

      case 'key': {
        // key may target a specific element or the active element
        let el: Element | null = null;
        if (typeof request.index === 'number' || request.selector) {
          el = (await resolveElement(request)).el;
        }
        return await actionKey(el, value ?? direction ?? 'Enter');
      }

      case 'navigate':
        if (!url) return { ok: false, summary: '', error: 'url is required for navigate' };
        return await actionNavigate(url);

      case 'scroll': {
        // Scroll a specific element into view if an index/selector is given and no
        // direction; otherwise scroll the page by direction.
        if (!direction && (typeof request.index === 'number' || request.selector)) {
          const { el, ref, error } = await resolveElement(request);
          if (!el) return { ok: false, summary: '', error: error || 'element not found' };
          (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 400));
          return { ok: true, summary: `Scrolled to ${ref}` };
        }
        return await actionScroll(direction ?? 'down');
      }

      default:
        return { ok: false, summary: '', error: `Unknown action type: ${actionType}` };
    }
  } catch (e) {
    return { ok: false, summary: '', error: (e as Error).message };
  }
}

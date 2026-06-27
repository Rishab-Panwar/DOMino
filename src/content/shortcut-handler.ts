import { getSettings, isMicPermissionGranted } from '../shared/storage';
import { ExtensionSettings } from '../shared/types';

let shortcutKey = 'Enter';
let holdDelayMs = 200;
let keyHeld = false;
let holdActive = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let cursorX = 0;
let cursorY = 0;
let lastMoveTime = 0;
let micPermissionCached = false;

async function loadSettings(): Promise<void> {
  const settings: ExtensionSettings = await getSettings();
  shortcutKey = settings.shortcutKey;
  holdDelayMs = settings.holdDelayMs;
}

async function loadMicPermission(): Promise<void> {
  micPermissionCached = await isMicPermissionGranted();
}

/**
 * True when the user is typing in a text field. Used so a Space/Enter shortcut
 * never hijacks normal typing, form submit, or newlines inside inputs, textareas,
 * or rich editors.
 */
function isEditableTarget(event: KeyboardEvent): boolean {
  const t = (event.target as HTMLElement) || (document.activeElement as HTMLElement);
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== shortcutKey) return;

  // When the shortcut is Space/Enter, don't intercept it while the user is typing
  // in a field, so typing, newlines, and form submit keep working.
  if ((shortcutKey === ' ' || shortcutKey === 'Enter') && isEditableTarget(event)) return;

  // Prevent key repeat from re-triggering
  if (keyHeld) return;

  console.log('[DOMino] KEY DOWN - shortcut held');
  keyHeld = true;

  // Prevent the character from being typed
  event.preventDefault();
  event.stopImmediatePropagation();

  // Start the hold delay timer
  holdTimer = setTimeout(() => {
    holdActive = true;

    if (!micPermissionCached) {
      // Mic not granted -- open welcome tab instead
      sendMsg({ action: 'open-welcome' });
      return;
    }

    // Fire hold event
    sendMsg({
      action: 'shortcut-hold',
      cursorX,
      cursorY,
    });

    // Emit custom event for content script UI (overlay indicator in Plan 02)
    document.dispatchEvent(
      new CustomEvent('domino-hold', {
        detail: { cursorX, cursorY },
      })
    );
  }, holdDelayMs);
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== shortcutKey) return;

  // Same editable guard as keydown, but only when we're NOT mid-hold (so an
  // in-progress recording still gets its release event).
  if ((shortcutKey === ' ' || shortcutKey === 'Enter') && !keyHeld && isEditableTarget(event)) return;

  console.log('[DOMino] KEY UP - shortcut released');
  event.preventDefault();
  event.stopImmediatePropagation();

  if (holdActive) {
    // Fire release event
    sendMsg({
      action: 'shortcut-release',
      cursorX,
      cursorY,
    });

    // Emit custom event for content script UI
    document.dispatchEvent(
      new CustomEvent('domino-release', {
        detail: { cursorX, cursorY },
      })
    );
  }

  // Clean up
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  keyHeld = false;
  holdActive = false;
}

function onMouseMove(event: MouseEvent): void {
  // Throttle to ~50ms
  const now = Date.now();
  if (now - lastMoveTime < 50) return;
  lastMoveTime = now;

  cursorX = event.clientX;
  cursorY = event.clientY;
}

function onWindowBlur(): void {
  // If key is held when window loses focus, treat as release
  if (keyHeld) {
    if (holdActive) {
      chrome.runtime.sendMessage({
        action: 'shortcut-release',
        cursorX,
        cursorY,
      });

      document.dispatchEvent(
        new CustomEvent('domino-release', {
          detail: { cursorX, cursorY },
        })
      );
    }

    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    keyHeld = false;
    holdActive = false;
  }
}

function onStorageChanged(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void {
  if (areaName !== 'local') return;

  if (changes['domino-settings']) {
    const newSettings = changes['domino-settings'].newValue;
    if (newSettings) {
      shortcutKey = newSettings.shortcutKey ?? shortcutKey;
      holdDelayMs = newSettings.holdDelayMs ?? holdDelayMs;
    }
  }

  if (changes['domino-mic-granted']) {
    micPermissionCached = changes['domino-mic-granted'].newValue === true;
  }
}

// Safe message sender — prevents unhandled promise rejections in MV3
function sendMsg(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch((err) => console.error('[DOMino] shortcut message send:', err));
}

export function initShortcutHandler(): void {
  // Load initial settings and mic permission state
  loadSettings();
  loadMicPermission();

  // Use capture phase (3rd argument = true) so events fire before page handlers
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('blur', onWindowBlur);

  // Listen for storage changes to update settings dynamically
  chrome.storage.onChanged.addListener(onStorageChanged);

  console.log('[DOMino] Shortcut handler initialized');
}

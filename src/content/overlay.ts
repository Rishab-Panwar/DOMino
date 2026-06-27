import { renderMarkdown } from './markdown';
import { ConversationInfo, DisplayMode } from '../shared/types';
import { speak, stop as stopTts, isTtsEnabled, setTtsEnabled, isSpeaking } from './tts';
import { getSettings } from '../shared/storage';

// SVG wave icon for TTS toggle
const WAVE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.7"><animate attributeName="height" values="4;8;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;4;6" dur="0.8s" repeatCount="indefinite"/></rect>
  <rect x="4.5" y="4" width="2" height="8" rx="1" fill="currentColor" opacity="0.85"><animate attributeName="height" values="8;12;8" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="4;2;4" dur="0.6s" repeatCount="indefinite"/></rect>
  <rect x="8" y="5" width="2" height="6" rx="1" fill="currentColor"><animate attributeName="height" values="6;10;6" dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="5;3;5" dur="0.7s" repeatCount="indefinite"/></rect>
  <rect x="11.5" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.7"><animate attributeName="height" values="4;7;4" dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="6;4.5;6" dur="0.9s" repeatCount="indefinite"/></rect>
</svg>`;

const WAVE_ICON_STATIC = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="4.5" y="4" width="2" height="8" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="8" y="5" width="2" height="6" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="11.5" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.4"/>
</svg>`;

// Inline styles for Shadow DOM isolation
const OVERLAY_STYLES = `
.domino-overlay {
  position: fixed;
  z-index: 2147483647;
  width: 420px;
  max-height: 480px;
  overflow-y: auto;
  padding: 16px 20px;
  border-radius: 16px;
  background: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  pointer-events: auto;
  user-select: text;
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.domino-overlay.visible {
  opacity: 1;
  transform: scale(1);
}

.domino-overlay.fade-out {
  opacity: 0;
  transform: scale(0.95);
}

.domino-stage {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.domino-stage::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  animation: domino-pulse 1.2s ease-in-out infinite;
}

/* ─── Chat History ─── */
.domino-history {
  display: none;
}

.domino-history.visible {
  display: block;
}

.domino-history-turn {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.domino-history-q {
  font-size: 12px;
  color: rgba(224, 224, 224, 0.6);
  font-style: italic;
  margin-bottom: 4px;
}

.domino-history-a {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.domino-history-a strong {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
}

.domino-history-a code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.domino-history-a ul {
  margin: 2px 0;
  padding-left: 16px;
}

.domino-history-a li {
  margin: 1px 0;
}

/* ─── Current Turn ─── */
.domino-transcript {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 12px;
  font-style: italic;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 8px;
  display: none;
}

.domino-transcript.visible {
  display: block;
}

.domino-response {
  /* Inherits overlay font */
}

.domino-response strong {
  font-weight: 600;
  color: rgba(255, 255, 255, 1);
}

.domino-response code {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 13px;
}

.domino-response ul {
  margin: 4px 0;
  padding-left: 18px;
}

.domino-response li {
  margin: 2px 0;
}

.domino-error {
  color: rgba(255, 120, 120, 0.9);
  font-size: 13px;
}

/* ─── Follow-up Input ─── */
.domino-followup {
  display: none;
  margin-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
}

.domino-followup.visible {
  display: block;
}

.domino-followup-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.domino-followup-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
  transition: border-color 0.2s ease;
}

.domino-followup-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.domino-followup-input:focus {
  border-color: rgba(255, 255, 255, 0.5);
}

.domino-followup-send {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  padding: 6px 10px;
  color: rgba(224, 224, 224, 0.9);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.domino-followup-send:hover {
  background: rgba(255, 255, 255, 0.3);
  color: #E0E0E0;
}

/* ─── Context Bar ─── */
.domino-context-bar {
  display: none;
  margin-top: 8px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

.domino-context-bar.visible {
  display: flex;
}

.domino-context-track {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.domino-context-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.6), rgba(224, 224, 224, 0.6));
  border-radius: 2px;
  transition: width 0.3s ease;
}

.domino-context-label {
  white-space: nowrap;
  min-width: 28px;
  text-align: right;
}

.domino-clear-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.domino-clear-btn:hover {
  color: rgba(255, 120, 120, 0.7);
  background: rgba(255, 120, 120, 0.08);
}

.domino-tts-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 5px;
  transition: all 0.15s ease;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.domino-tts-btn.active {
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.08);
}

.domino-tts-btn:hover {
  color: rgba(224, 224, 224, 0.9);
  border-color: rgba(255, 255, 255, 0.4);
}

.domino-overlay::-webkit-scrollbar {
  width: 4px;
}

.domino-overlay::-webkit-scrollbar-track {
  background: transparent;
}

.domino-overlay::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.domino-overlay::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

@keyframes domino-pulse {
  0%, 100% {
    opacity: 0.4;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* ─── Audio-only speaking waveform ─── */
.domino-speaking-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 16px 0;
}

.domino-speaking-wave .wave-bar {
  width: 4px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(224, 224, 224, 0.9), rgba(255, 255, 255, 0.6));
  animation: domino-wave-bar 1.2s ease-in-out infinite;
}

.domino-speaking-wave .wave-bar:nth-child(1)  { height: 8px;  animation-delay: 0s; }
.domino-speaking-wave .wave-bar:nth-child(2)  { height: 14px; animation-delay: 0.1s; }
.domino-speaking-wave .wave-bar:nth-child(3)  { height: 20px; animation-delay: 0.15s; }
.domino-speaking-wave .wave-bar:nth-child(4)  { height: 26px; animation-delay: 0.2s; }
.domino-speaking-wave .wave-bar:nth-child(5)  { height: 32px; animation-delay: 0.25s; }
.domino-speaking-wave .wave-bar:nth-child(6)  { height: 28px; animation-delay: 0.3s; }
.domino-speaking-wave .wave-bar:nth-child(7)  { height: 34px; animation-delay: 0.35s; }
.domino-speaking-wave .wave-bar:nth-child(8)  { height: 24px; animation-delay: 0.4s; }
.domino-speaking-wave .wave-bar:nth-child(9)  { height: 30px; animation-delay: 0.45s; }
.domino-speaking-wave .wave-bar:nth-child(10) { height: 20px; animation-delay: 0.5s; }
.domino-speaking-wave .wave-bar:nth-child(11) { height: 26px; animation-delay: 0.55s; }
.domino-speaking-wave .wave-bar:nth-child(12) { height: 16px; animation-delay: 0.6s; }
.domino-speaking-wave .wave-bar:nth-child(13) { height: 10px; animation-delay: 0.65s; }

@keyframes domino-wave-bar {
  0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
  50%      { transform: scaleY(1);   opacity: 1; }
}

.domino-speaking-label {
  text-align: center;
  font-size: 11px;
  color: rgba(224, 224, 224, 0.5);
  margin-top: 4px;
  letter-spacing: 0.05em;
}
`;

const STAGE_LABELS: Record<string, string> = {
  transcribing: 'Transcribing...',
  thinking: 'Thinking...',
};

export class Overlay {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private overlayEl: HTMLDivElement | null = null;
  private stageEl: HTMLDivElement | null = null;
  private historyEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLDivElement | null = null;
  private responseEl: HTMLDivElement | null = null;
  private followupEl: HTMLDivElement | null = null;
  private followupInput: HTMLInputElement | null = null;
  private contextBar: HTMLDivElement | null = null;
  private contextFill: HTMLDivElement | null = null;
  private contextLabel: HTMLSpanElement | null = null;
  private ttsBtn: HTMLButtonElement | null = null;
  private visible = false;
  private tracking = false;
  private accumulatedText = '';
  private currentTranscript = '';
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsPollTimer: ReturnType<typeof setInterval> | null = null;
  private onFollowUp: ((text: string) => void) | null = null;
  private onClear: (() => void) | null = null;
  private displayMode: DisplayMode = 'both';

  setCallbacks(onFollowUp: (text: string) => void, onClear: () => void): void {
    this.onFollowUp = onFollowUp;
    this.onClear = onClear;
  }

  show(cursorX: number, cursorY: number): void {
    // Re-invocation: dismiss old overlay first
    if (this.visible) {
      this.dismissImmediate();
    }

    // Read display mode in background (non-blocking so DOM is created immediately)
    getSettings().then(settings => {
      this.displayMode = settings.displayMode;
    });

    // Create host container
    this.container = document.createElement('div');
    this.container.id = 'domino-overlay-host';
    this.container.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    // Attach closed Shadow DOM
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_STYLES;
    this.shadowRoot.appendChild(styleEl);

    // Create overlay card
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'domino-overlay';

    // Position: near cursor with edge detection
    this.positionOverlay(cursorX, cursorY);

    // Stage label
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'domino-stage';
    this.stageEl.textContent = '';
    this.overlayEl.appendChild(this.stageEl);

    // Chat history area (previous turns, hidden initially)
    this.historyEl = document.createElement('div');
    this.historyEl.className = 'domino-history';
    this.overlayEl.appendChild(this.historyEl);

    // Transcript (hidden initially)
    this.transcriptEl = document.createElement('div');
    this.transcriptEl.className = 'domino-transcript';
    this.overlayEl.appendChild(this.transcriptEl);

    // Response area
    this.responseEl = document.createElement('div');
    this.responseEl.className = 'domino-response';
    this.overlayEl.appendChild(this.responseEl);

    // Follow-up input section
    this.followupEl = document.createElement('div');
    this.followupEl.className = 'domino-followup';

    const followupRow = document.createElement('div');
    followupRow.className = 'domino-followup-row';

    this.followupInput = document.createElement('input');
    this.followupInput.type = 'text';
    this.followupInput.className = 'domino-followup-input';
    this.followupInput.placeholder = 'Ask a follow-up...';
    // Single capture-phase listener handles Enter/Escape and blocks shortcut handler
    this.followupInput.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.followupInput?.value.trim()) {
        e.preventDefault();
        this.sendFollowUp();
      }
      if (e.key === 'Escape') {
        this.followupInput?.blur();
      }
    }, true);
    this.followupInput.addEventListener('keyup', (e: KeyboardEvent) => {
      e.stopPropagation();
    }, true);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'domino-followup-send';
    sendBtn.textContent = 'Send';
    sendBtn.addEventListener('click', () => this.sendFollowUp());

    followupRow.appendChild(this.followupInput);
    followupRow.appendChild(sendBtn);
    this.followupEl.appendChild(followupRow);

    // Context bar
    this.contextBar = document.createElement('div');
    this.contextBar.className = 'domino-context-bar';

    // TTS wave toggle
    this.ttsBtn = document.createElement('button');
    this.ttsBtn.className = `domino-tts-btn${isTtsEnabled() ? ' active' : ''}`;
    this.ttsBtn.innerHTML = isTtsEnabled() ? WAVE_ICON_SVG : WAVE_ICON_STATIC;
    this.ttsBtn.title = 'Toggle read aloud';
    this.ttsBtn.addEventListener('click', () => {
      const newState = !isTtsEnabled();
      setTtsEnabled(newState);
      if (this.ttsBtn) {
        this.ttsBtn.classList.toggle('active', newState);
        this.ttsBtn.innerHTML = newState ? WAVE_ICON_SVG : WAVE_ICON_STATIC;
      }
    });

    const contextTrack = document.createElement('div');
    contextTrack.className = 'domino-context-track';
    this.contextFill = document.createElement('div');
    this.contextFill.className = 'domino-context-fill';
    this.contextFill.style.width = '0%';
    contextTrack.appendChild(this.contextFill);

    this.contextLabel = document.createElement('span');
    this.contextLabel.className = 'domino-context-label';
    this.contextLabel.textContent = '0%';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'domino-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      if (this.onClear) {
        this.onClear();
        this.updateConversationInfo({ turns: 0, maxTurns: 20 });
        // Clear history display
        if (this.historyEl) {
          this.historyEl.innerHTML = '';
          this.historyEl.classList.remove('visible');
        }
      }
    });

    this.contextBar.appendChild(this.ttsBtn);
    this.contextBar.appendChild(contextTrack);
    this.contextBar.appendChild(this.contextLabel);
    this.contextBar.appendChild(clearBtn);
    this.followupEl.appendChild(this.contextBar);

    this.overlayEl.appendChild(this.followupEl);

    this.shadowRoot.appendChild(this.overlayEl);
    document.body.appendChild(this.container);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      if (this.overlayEl) {
        this.overlayEl.classList.add('visible');
      }
    });

    // Escape key listener (capture phase so it fires before page handlers)
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.shadowRoot?.activeElement === this.followupInput) return;
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

    // Start cursor tracking — overlay follows mouse during loading
    this.startTracking();

    this.visible = true;
  }

  private startTracking(): void {
    if (this.tracking) return;
    this.tracking = true;
    this.mouseMoveHandler = (e: MouseEvent) => {
      this.positionOverlay(e.clientX, e.clientY);
    };
    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
  }

  private stopTracking(): void {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
  }

  updateStage(stage: string, transcript?: string): void {
    if (!this.stageEl) return;

    const label = STAGE_LABELS[stage];
    if (label) {
      this.stageEl.textContent = label;
      this.stageEl.style.display = 'flex';
    } else {
      this.stageEl.style.display = 'none';
      this.stageEl.textContent = '';
    }

    // Show transcript if provided
    if (transcript && this.transcriptEl) {
      this.currentTranscript = transcript;
      this.transcriptEl.textContent = `"${transcript}"`;
      this.transcriptEl.classList.add('visible');
    }
  }

  appendChunk(text: string): void {
    if (!this.responseEl) return;

    // Lock position once content starts streaming
    if (!this.accumulatedText && this.tracking) {
      this.stopTracking();
    }

    this.accumulatedText += text;

    // In audio-only mode, don't render the text
    if (this.displayMode === 'audio-only') return;

    this.responseEl.innerHTML = renderMarkdown(this.accumulatedText);

    // Auto-scroll to bottom if user hasn't scrolled up
    if (this.overlayEl) {
      const el = this.overlayEl;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  /** Called when stream is complete — show the follow-up input */
  onStreamComplete(): void {
    // In audio-only mode, hide the text content and show waveform
    if (this.displayMode === 'audio-only') {
      if (this.responseEl) {
        const bars = Array.from({ length: 13 }, () => '<div class="wave-bar"></div>').join('');
        this.responseEl.innerHTML =
          `<div class="domino-speaking-wave">${bars}</div>` +
          `<div class="domino-speaking-label">Preparing audio...</div>`;
      }
      if (this.transcriptEl) {
        this.transcriptEl.style.display = 'none';
      }
      if (this.historyEl) {
        this.historyEl.style.display = 'none';
      }
      if (this.stageEl) {
        this.stageEl.style.display = 'none';
      }
    }

    if (this.followupEl && this.displayMode !== 'audio-only') {
      this.followupEl.classList.add('visible');
    }
    if (this.contextBar && this.displayMode !== 'audio-only') {
      this.contextBar.classList.add('visible');
    }
    // TTS is now triggered by the separate tts-summary message
  }

  /** Called when TTS summary arrives from the service worker */
  speakSummary(summary: string): void {
    if (this.displayMode === 'text-only') return;
    speak(summary);

    // In audio-only mode, update label and auto-dismiss when TTS finishes
    if (this.displayMode === 'audio-only') {
      // Update label to "Speaking..."
      if (this.responseEl) {
        const label = this.responseEl.querySelector('.domino-speaking-label');
        if (label) label.textContent = 'Speaking...';
      }

      this.ttsPollTimer = setInterval(() => {
        if (!isSpeaking()) {
          if (this.ttsPollTimer) {
            clearInterval(this.ttsPollTimer);
            this.ttsPollTimer = null;
          }
          this.dismiss();
        }
      }, 500);
    }
  }

  updateConversationInfo(info: ConversationInfo): void {
    const pct = info.maxTurns > 0 ? Math.round((info.turns / info.maxTurns) * 100) : 0;
    if (this.contextFill) {
      this.contextFill.style.width = `${pct}%`;
    }
    if (this.contextLabel) {
      this.contextLabel.textContent = `${pct}%`;
    }
  }

  /** Prepare overlay for a new streaming response (follow-up) */
  prepareForFollowUp(): void {
    // Stop any in-progress TTS
    stopTts();

    // Re-start cursor tracking for the new response
    this.startTracking();

    // Move current Q&A into history before clearing
    if (this.accumulatedText && this.historyEl) {
      const turnEl = document.createElement('div');
      turnEl.className = 'domino-history-turn';

      if (this.currentTranscript) {
        const qEl = document.createElement('div');
        qEl.className = 'domino-history-q';
        qEl.textContent = `"${this.currentTranscript}"`;
        turnEl.appendChild(qEl);
      }

      const aEl = document.createElement('div');
      aEl.className = 'domino-history-a';
      aEl.innerHTML = renderMarkdown(this.accumulatedText);
      turnEl.appendChild(aEl);

      this.historyEl.appendChild(turnEl);
      this.historyEl.classList.add('visible');
    }

    // Hide follow-up input during processing
    if (this.followupEl) {
      this.followupEl.classList.remove('visible');
    }

    // Clear current response area
    this.accumulatedText = '';
    this.currentTranscript = '';
    if (this.responseEl) {
      this.responseEl.innerHTML = '';
    }
    if (this.transcriptEl) {
      this.transcriptEl.textContent = '';
      this.transcriptEl.classList.remove('visible');
    }

    // Reset stage
    if (this.stageEl) {
      this.stageEl.style.display = 'flex';
      this.stageEl.textContent = '';
    }
  }

  showError(error: string): void {
    if (this.stageEl) {
      this.stageEl.style.display = 'none';
    }

    if (this.responseEl) {
      this.responseEl.innerHTML = '';
    }

    const errorEl = document.createElement('div');
    errorEl.className = 'domino-error';
    errorEl.textContent = error;

    if (this.overlayEl) {
      this.overlayEl.appendChild(errorEl);
    }

    // Show follow-up input even on error
    if (this.followupEl) {
      this.followupEl.classList.add('visible');
    }
    if (this.contextBar) {
      this.contextBar.classList.add('visible');
    }

    this.autoDismissTimer = setTimeout(() => {
      this.dismiss();
    }, 8000);
  }

  dismiss(): void {
    if (!this.visible || !this.overlayEl) {
      this.cleanup();
      return;
    }

    this.overlayEl.classList.add('fade-out');
    this.overlayEl.classList.remove('visible');

    setTimeout(() => {
      this.cleanup();
    }, 180);

    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Temporarily hide for screenshot capture (no animation, no cleanup) */
  hideForScreenshot(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /** Re-show after screenshot capture */
  showAfterScreenshot(): void {
    if (this.container) {
      this.container.style.display = '';
    }
  }

  private dismissImmediate(): void {
    this.cleanup();
    this.visible = false;
  }

  private sendFollowUp(): void {
    if (!this.followupInput) return;
    const text = this.followupInput.value.trim();
    if (!text) return;

    this.followupInput.value = '';

    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }

    // Remove any error messages
    if (this.overlayEl) {
      const errors = this.overlayEl.querySelectorAll('.domino-error');
      errors.forEach((el) => el.remove());
    }

    this.prepareForFollowUp();

    if (this.onFollowUp) {
      this.onFollowUp(text);
    }
  }

  private cleanup(): void {
    stopTts();
    this.stopTracking();

    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true);
      this.escapeHandler = null;
    }

    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }

    if (this.ttsPollTimer) {
      clearInterval(this.ttsPollTimer);
      this.ttsPollTimer = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.shadowRoot = null;
    this.overlayEl = null;
    this.stageEl = null;
    this.historyEl = null;
    this.transcriptEl = null;
    this.responseEl = null;
    this.followupEl = null;
    this.followupInput = null;
    this.contextBar = null;
    this.contextFill = null;
    this.contextLabel = null;
    this.ttsBtn = null;
    this.accumulatedText = '';
    this.currentTranscript = '';
  }

  private positionOverlay(cursorX: number, cursorY: number): void {
    if (!this.overlayEl) return;

    const overlayWidth = 420;
    const overlayMaxHeight = 480;
    const offset = 20;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: string;
    let translateX = '';
    if (cursorX < overlayWidth / 2 + 10) {
      left = `${Math.max(10, cursorX)}px`;
    } else if (cursorX > vw - overlayWidth / 2 - 10) {
      left = `${Math.min(vw - 10, cursorX)}px`;
      translateX = 'translateX(-100%)';
    } else {
      left = `${cursorX}px`;
      translateX = 'translateX(-50%)';
    }

    let top: string;
    let translateY = '';
    if (cursorY + offset + overlayMaxHeight > vh) {
      top = `${cursorY - offset}px`;
      translateY = 'translateY(-100%)';
    } else {
      top = `${cursorY + offset}px`;
    }

    const transform = [translateX, translateY].filter(Boolean).join(' ') || 'none';
    this.overlayEl.style.left = left;
    this.overlayEl.style.top = top;
    this.overlayEl.style.transform = transform;
  }
}

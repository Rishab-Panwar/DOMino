<p align="center">
  <img src="public/icons/icon-128.png" alt="DOMino" width="90" />
</p>

<h1 align="center">DOMino</h1>

<p align="center">
  <strong>Say it. Watch it fall into place.</strong><br/>
  A voice-driven browser agent. Speak a command and DOMino sees your screen, reasons about what to do, and executes it: clicking, typing, navigating, and completing whole tasks. One word topples the whole chain.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=google-chrome" alt="Chrome MV3" />
  <img src="https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/AI-Gemini%20(Vertex%20AI)-ffb020?style=flat-square" alt="Gemini" />
  <img src="https://img.shields.io/badge/Runs-100%25%20Locally-9aa0b4?style=flat-square" alt="Local" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" />
</p>

---
<img width="1536" height="1024" alt="domino theme" src="https://github.com/user-attachments/assets/a90c2e69-c893-4741-91cc-d6101ab1d50c" />

## What is DOMino?

DOMino is a Chrome extension (Manifest V3) that turns your **voice** into **browser actions**. Hold **Enter**, speak a command, release, and an AI agent captures your screen, reads the page as a numbered map of every actionable element, and carries out the task autonomously in a tight **observe, reason, act** loop.

**The name:** **DOM** is the Document Object Model, the structure of every web page DOMino operates on. **Domino** is the chain reaction: one spoken command topples a whole sequence of actions that fall into place.

**Example:** *"Search YouTube and play some lofi"* or *"Compose an email to Sam about the meeting and send it."* DOMino navigates, types, clicks, and finishes the task hands-free.

It is **not** scripted for specific sites. Because it acts on the page's own DOM (resolving elements by index, not brittle selectors) and reasons over a screenshot plus a structured page map, it works on virtually any website.

> **Runs 100% locally.** Everything runs on your own machine: a local FastAPI backend plus the extension loaded in your browser. Your API keys and data never leave your computer. There is no hosted service; the website is just a showcase.

---

## How it works

```
You hold Enter and speak
        |
        v
[ Content scripts ]  ::  Shortcut handler, cursor bubble (Shadow DOM),
        |                 DOM scraper (indexed element map), action executor (by index), TTS
        |  (chrome.runtime messages)
        v
[ Service worker ]   ::  Agent loop (scoped batching, max 25 iterations),
        |                 per-tab conversation state, screenshot capture, mic (offscreen)
        |  (HTTP / SSE to localhost:8000)
        v
[ FastAPI backend ]  ::  /task, /task/continue, /transcribe, /events (SSE), Firecrawl
        |
        v
[ AI providers ]     ::  Reasoning: Gemini via Vertex AI (default; pluggable)
                         Voice: ElevenLabs (STT + TTS)   Page text: Firecrawl
```

### The agent loop
1. You hold **Enter** (outside text fields) and speak.
2. Audio is recorded in an offscreen document (MV3 mic sandbox) and transcribed by ElevenLabs.
3. The service worker captures a **screenshot**, and the content script scrapes a **DOM map**: every interactive element gets a numeric index (set-of-marks).
4. Firecrawl extracts clean page markdown for extra context.
5. The backend sends command + screenshot + element map + markdown to the model, which replies with one or more **actions referenced by element index**.
6. The executor performs the action(s) on the exact registered element. Consecutive safe fills (type/select/key) are **batched** into one round-trip; anything page-changing (click/navigate) forces a fresh observation.
7. Re-observe and repeat until the task is done.

### Why it is reliable
- **Indexed targeting:** the model points at element `[12]`, and the executor acts on that exact node. No selector guessing, no escaping, no staleness.
- **Multimodal perception:** screenshot (vision) + structured DOM map + page text.
- **Scoped batching:** fewer model calls (faster, lighter on rate limits) without losing accuracy.

---

## Architecture

| Layer | Tech |
|-------|------|
| Extension | TypeScript, React 18, Webpack 5, Chrome MV3 |
| Backend | Python 3.10+, FastAPI, uvicorn |
| Reasoning (default) | Google Gemini via Vertex AI (multimodal: vision + language) |
| Reasoning (pluggable) | Gemini (AI Studio), Claude / DeepSeek / Llama (OpenRouter), Llama (Groq), Claude / Nova (AWS Bedrock) |
| Speech-to-Text | ElevenLabs (primary), Groq Whisper, Deepgram (fallbacks) |
| Text-to-Speech | ElevenLabs (primary), Web Speech API (fallback) |
| Page understanding | Firecrawl (pages to clean markdown) |

---

## Run it locally (detailed)

Everything runs on your machine. You will start a **backend** in one terminal and load the **extension** into Chrome.

### Prerequisites
- **Node.js** 18+ and npm
- **Python** 3.10 to 3.12
- **Google Chrome** (latest)
- A **reasoning provider** (the default is Google Vertex AI; see the model table) and an **ElevenLabs** API key for voice

### 1. Clone and install
```bash
git clone https://github.com/Rishab-Panwar/DOMino.git
cd DOMino

# Frontend dependencies
npm install

# Backend dependencies (in a virtual environment)
cd backend
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS / Linux:         source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 2. Configure the backend (`backend/.env`)
```bash
cp backend/.env.example backend/.env
```
Open `backend/.env` and pick **one** reasoning provider via `DOMINO_MODEL`:

| `DOMINO_MODEL` | Provider | Vision | What you need |
|----------------------|----------|:------:|----------------|
| `vertex-gemini-flash` *(default)* | **Google Vertex AI** | yes | `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, and a service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS`. Billed to your GCP project/credits, no per-minute rate walls. |
| `gemini-flash`, `gemini-flash-lite` | **Google AI Studio** | yes | `GEMINI_API_KEY` (free key, no card). Easiest to start; the free tier is rate-limited. |
| `openrouter-gemini-free`, `openrouter-deepseek-free`, `openrouter-claude` | **OpenRouter** | yes / text | `OPENROUTER_API_KEY`. Free models need no card; paid models accept crypto/cards. |
| `groq-llama-70b`, `groq-llama` | **Groq** | text / yes | `GROQ_API_KEY` (free). Very fast; free tier limits tokens per minute. |
| `claude-haiku`, `claude-sonnet`, `nova-lite` | **AWS Bedrock** | yes | AWS credentials + Bedrock model access. |

#### Setting up the default (Vertex AI Gemini)
1. In Google Cloud Console, enable the **Vertex AI API** on your project.
2. **IAM and Admin → Service Accounts** → create one with the **Vertex AI User** role → create a **JSON key** and download it.
3. In `backend/.env`:
   ```env
   DOMINO_MODEL=vertex-gemini-flash
   VERTEX_PROJECT_ID=your-gcp-project-id
   VERTEX_LOCATION=us-central1
   GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
   ```
   (Alternatively, run `gcloud auth application-default login` and leave `GOOGLE_APPLICATION_CREDENTIALS` unset.)

Other backend keys (optional but recommended):
```env
FIRECRAWL_API_KEY=...     # richer page context (page to markdown)
GROQ_API_KEY=...          # used by the backend /transcribe fallback
BACKEND_PORT=8000
```

> **Two separate key stores.** **Reasoning + Firecrawl** keys live in `backend/.env`. **Speech-to-text and text-to-speech** keys (ElevenLabs, Groq, Deepgram) are entered in the **extension's Settings page** (stored locally in your browser), not in `.env`.

### 3. Start the backend (from the project root)
```bash
# venv active, from the repository root (not from backend/)
python -m backend.main
```
Wait for `Uvicorn running on http://0.0.0.0:8000`. Verify:
- `http://localhost:8000/health` returns `{"status":"ok"}`
- `http://localhost:8000/models` shows your active model

### 4. Build and load the extension
```bash
# from the project root
npm run build
```
1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select the **`dist/`** folder
4. Complete the welcome flow and grant **microphone** access
5. Open the extension's **Settings** and:
   - Paste your **ElevenLabs** API key (required for voice). Optionally add Groq/Deepgram as STT fallbacks.
   - The shortcut defaults to **Enter**. To confirm or change it, click the **Shortcut Key** field and press your key.

### 5. Use it
1. Open any normal website (not a `chrome://` page).
2. **Hold Enter** (while not focused in a text box) and speak your command.
3. **Release** and watch DOMino reason and act. Press **Esc** to cancel.

> Day to day you only need the backend running (`python -m backend.main`) and the extension loaded. Re-run `npm run build` + reload the extension only after you change `src/`.

---

## Features
- **Voice to action:** hold Enter, speak, release; natural commands become real browser actions.
- **Sees your screen:** a screenshot plus a structured, numbered map of every interactive element.
- **Autonomous loop:** re-observes after each action and decides the next step, up to a full multi-step task.
- **Works on any website:** search, shop, fill forms, compose email, navigate between sites.
- **Speaks back:** natural ElevenLabs voice readback; answers questions about the page out loud.
- **Multi-turn:** follow-ups, corrections, and chained requests with per-tab context.
- **Pluggable AI:** switch the reasoning provider with one setting.
- **Local and private:** runs entirely on your machine; keys never leave your computer.

---

## Project structure
```
DOMino/
├── src/
│   ├── background/         # Service worker: agent loop + scoped batching, transcription, screenshot
│   ├── content/            # Injected into pages: dom-scraper (indexed map), action-executor (by index),
│   │                       #   cursor-bubble (Shadow DOM UI), tts, shortcut-handler
│   ├── offscreen/ popup/ settings/ welcome/ shared/
│   └── __tests__/          # Frontend tests (Jest)
├── backend/
│   ├── main.py             # FastAPI app (/health, /models, /task, /transcribe, /events, /firecrawl)
│   ├── routers/  services/ # nova_reasoning (multi-provider), nova_sonic, firecrawl_service, event_bus
│   └── tests/              # Backend tests (pytest)
├── landing/                # Static showcase site
├── dist/                   # Built extension (load this in Chrome)
├── manifest.json
└── webpack.config.js
```

---

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/models` | List available models and the active one |
| `POST` | `/task` | Initial reasoning (command + screenshot + element map) |
| `POST` | `/task/continue` | Multi-turn continuation with action history |
| `GET` | `/events` | Server-Sent Events for real-time status |
| `POST` | `/transcribe` | Batch audio transcription |
| `POST` | `/firecrawl/scrape` etc. | Page understanding |

Interactive docs at `http://localhost:8000/docs` while the backend runs.

---

## Testing
```bash
# Backend (from project root, venv active)
python -m pytest backend -v

# Frontend
npm test
```

---

## Troubleshooting
| Issue | Fix |
|-------|-----|
| Holding Enter does nothing | Make sure you are not focused in a text field (Enter submits forms or adds a newline there by design). Click an empty area of the page first, then hold Enter. |
| Shortcut still feels like the old key | Open Settings, click Shortcut Key, press Enter, Save, then reload the tab. |
| Bubble doesn't appear | Reload the page. DOMino doesn't run on `chrome://` pages. After a rebuild, reload the extension. |
| "All STT providers failed" | Enter your ElevenLabs key in the extension Settings (STT keys are not in `.env`). |
| Backend unavailable | Verify `http://localhost:8000/health` returns OK. |
| Reasoning errors / rate limits | Check `/models` shows your intended provider; some free tiers are rate-limited. Vertex AI has no per-minute walls. |
| No audio response | Check Display Mode isn't "Text Only" and your ElevenLabs voice is a premade one (library voices need a paid plan). |

---

## License
MIT

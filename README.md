# LocalChat

A fully offline, chatbot interface for your local Ollama models. No cloud. No telemetry. No backend server. Runs entirely in your browser.

---

## Features

- Real-time streaming responses from any Ollama model
- Sidebar with grouped chat history (Today / Yesterday / Last 7 days / Older)
- Rename and delete chats
- Switch models mid-chat via a dropdown in the header
- Markdown rendering with syntax-highlighted code blocks
- Copy button on code blocks and messages
- Dark / light theme toggle
- All chat history persisted in localStorage (survives refreshes)
- Clear chat without losing the session
- Zero backend: talks directly to Ollama via a Vite proxy

---

## Prerequisites

1. **Ollama** must be installed and running.
   - Install: https://ollama.com or curl -fsSL https://ollama.com/install.sh | sh

   - Start: `ollama serve` (or it may already be running as a systemd service)

2. **Node.js 18+** and **npm**.

---

## Setup

```
# Clone or copy the project
cd ~/projects  # wherever you keep things

# Install dependencies (one-time)
cd ollama

npm install

npm run dev
```

---

## Run

```
python3 run.py
```

Open http://localhost:5176 in your browser.

The Vite dev server proxies all `/ollama/*` requests to (example) `http://127.0.0.1:5176`,
so you do not need to configure any CORS settings in Ollama.

---

## Current Models examples (Cmd: ollama list)

```
ministral-3:8b    6.0 GB
qwen2.5:3b        1.9 GB
gemma4:e4b        9.6 GB
phi4:latest       9.1 GB
llama3.1:latest   4.9 GB
```

All of these will appear automatically in the model dropdown once Ollama is running.

---

## Adding New Models

```
ollama pull mistral

ollama pull codellama

ollama pull deepseek-coder-v2
```

Refresh the browser tab after pulling. The new model appears in the dropdown immediately.

---

## Build for Production

If you want to serve the app as a static build (e.g. with nginx):

```
npm run build

npm run preview   # serves the built app on port 5173, still with the Ollama proxy
```

For a proper production nginx setup, you would proxy `/ollama/` to `http://127.0.0.1:5176/`
in your nginx config.

---


## Data Storage

All chat sessions are stored in your browser's `localStorage` under the key `localchat-v1`.
No files are written to disk by the app itself.

To export or back up chats, open DevTools → Application → Local Storage → `localchat-v1`
and copy the JSON value.

---

## Troubleshooting

**"Could not connect to Ollama"**
- Run `ollama serve` in a terminal.

- Check `ss -tlnp | grep 5176` to confirm it is listening.

**Model not appearing in the dropdown**
- Run `ollama list` to verify it is downloaded.

- Refresh the browser tab.

**Slow responses**
- This is normal for large models (phi4, gemma4, etc) on CPU.

- Use `qwen2.5:3b` for fast responses on lighter hardware.

---

## Tech Stack

| Layer         | Technology                              |
|---------------|-----------------------------------------|
| UI framework  | React 18 + TypeScript + Vite            |
| Styling       | Tailwind CSS                            |
| State / store | Zustand (persisted to localStorage)     |
| Markdown      | react-markdown + remark-gfm             |
| Highlighting  | rehype-highlight + highlight.js         |
| Icons         | lucide-react                            |
| LLM backend   | Ollama (local, via Vite proxy)          |
| Fonts         | DM Sans + JetBrains Mono (Google Fonts) |

## License

Distributed under the MIT License. See [LICENSE](LICENSE).

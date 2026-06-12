# LocalChat

A fully offline chat interface for your local Ollama models. No cloud. No telemetry. Runs a lightweight Python backend with optional RAG support.

## Features

- Real-time streaming responses from any Ollama model
- Sidebar with grouped chat history (Today / Yesterday / Last 7 days / Older)
- Rename and delete chats
- Switch models mid-chat via a dropdown in the header
- Markdown rendering with syntax-highlighted code blocks
- Copy button on code blocks and messages
- Dark / light theme toggle
- Chat history persisted in `localStorage` (survives refreshes)
- Clear chat without losing the session
- RAG (Retrieval-Augmented Generation) support via ChromaDB
- Python FastAPI backend proxies all Ollama requests (avoids CORS issues)

## Prerequisites

1. **Ollama** must be installed and running.

   - Install: https://ollama.com or `curl -fsSL https://ollama.com/install.sh | sh`

   - Start: `ollama serve` (or it may already be running as a systemd service)

   - Pull at least one model: `ollama pull llama3.2`

2. **Node.js 18+** and **npm** (for building the frontend).

3. **Python 3.10+** and **pip** (for the backend).

## Setup

```
# Clone or copy the project
git clone https://github.com/macbuildssys/ollama-orig.git

cd ollama-orig

# Install frontend dependencies (one-time)
npm install

# Create and activate a Python virtual environment (one-time)
python3 -m venv venv

source venv/bin/activate   # fish shell: source venv/bin/activate.fish

# Install backend dependencies (one-time)
pip install -r requirements.txt

# Build the frontend
npm run build
```

## Run

```
source venv/bin/activate   # fish shell: source venv/bin/activate.fish

python3 run.py
```

Open http://localhost:8765 in your browser.

The backend proxies all Ollama requests, so you do not need to configure CORS settings in Ollama.

## Accessing from Another Machine or VM

By default, LocalChat binds to `127.0.0.1:8765` and is only reachable from the same machine.

To allow access from another device on your network (e.g. a VM host or a second machine), start with:

```
OLLAMA_HOST=0.0.0.0 python3 run.py
```

Alternatively, edit the script `run.py` and change the uvicorn host from `0.0.0.0` to `127.0.0.1 (this is the current default). Then open the machine's local network IP in your browser:

```
http://192.168.x.x:8765
```

Note: `crypto.randomUUID()` requires a secure context in modern browsers. When accessing over plain HTTP from a non-localhost address, the app patches this automatically. If you see UUID-related errors, rebuild after pulling the latest changes.

If the host Ollama is on a different machine than where LocalChat is running, set the `OLLAMA_HOST` environment variable before starting:

```
OLLAMA_HOST=http://192.168.xxx.xxx:11434 python3 run.py
```

Make sure Ollama on the remote machine is also bound to `0.0.0.0`:

```
# On the machine running Ollama, edit its systemd service:

sudo systemctl edit ollama

# Add (Add the service and environment as shown below):

# [Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"

# Restart ollama:

sudo systemctl restart ollama
```

## Current Models (example: `ollama list`)

```
qwen3:4b                   2.5 GB
phi4-mini:latest           2.5 GB
llama3.2:3b                2.0 GB
ministral-3:3b             3.0 GB
deepseek-r1:1.5b           1.1 GB
gemma4:e4b                 9.6 GB
nomic-embed-text:latest    274 MB
```

All of these appear automatically in the model dropdown once Ollama is running.

## Adding New Models

```
ollama pull mistral

ollama pull codellama

ollama pull deepseek-coder-v2
```

Refresh the browser tab after pulling. The new model appears in the dropdown immediately.

## Build for Production

```
npm run build

python3 run.py
```

The backend serves the built frontend directly. There is no separate static file server needed.

## Data Storage

Chat sessions are stored in your browser's `localStorage` under the key `localchat-v1`. No chat data is written to disk by the app itself.

RAG document embeddings are stored in a local ChromaDB database at `./chroma_db/` inside the project directory. This persists across restarts.

To export or back up chats, open DevTools (F12 or Ctrl + Shift + I) and navigate to Application > Local Storage (Chrome) or Storage > Local Storage (Firefox), then copy the JSON value under the `localchat-v1` key.

## Troubleshooting

**"Could not connect to Ollama"**
- Run `ollama serve` in a terminal.

- Check `ss -tlnp | grep 11434` to confirm Ollama is listening.

- If Ollama is on a different machine, set `OLLAMA_HOST` as described above and ensure port 11434 is not blocked by a firewall.

**Backend fails to start with `ModuleNotFoundError`**
- Make sure the virtual environment is activated: `source venv/bin/activate.fish`

- Run `pip install -r requirements.txt` inside the venv.

**Model not appearing in the dropdown**
- Run `ollama list` to verify it is downloaded.

- Refresh the browser tab.

**Slow responses**
- Normal for large models (gemma4, phi4, etc.) on CPU.

- Use `qwen3:4b` or `llama3.2:3b` for faster responses on lighter hardware.

**Port 8765 not reachable from another machine**
- Check the firewall on the machine running LocalChat: `sudo ufw allow 8765`

- Confirm the backend is bound to `0.0.0.0` and not `127.0.0.1`.

## Tech Stack

| Layer            | Technology                              |
|------------------|-----------------------------------------|
| UI framework     | React 18 + TypeScript + Vite            |
| Styling          | Tailwind CSS                            |
| State / store    | Zustand (persisted to localStorage)     |
| Markdown         | react-markdown + remark-gfm             |
| Highlighting     | rehype-highlight + highlight.js         |
| Icons            | lucide-react                            |
| Fonts            | DM Sans + JetBrains Mono (Google Fonts) |
| Backend          | Python + FastAPI + uvicorn              |
| RAG / embeddings | ChromaDB                                |
| HTTP client      | httpx                                   |
| LLM backend      | Ollama (local)                          |

## License

Distributed under the MIT License. See [LICENSE](LICENSE).
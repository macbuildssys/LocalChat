import type { OllamaModel, Message, PendingAttachment } from '../types';

const API = '/api';

export async function fetchModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error(`Cannot reach backend (${res.status}). Is it running?`);
  const data = await res.json();
  return (data.models ?? []) as OllamaModel[];
}

type ApiMessage = { role: 'user' | 'assistant'; content: string; images?: string[] };

export async function* streamChat(
  model: string,
  messages: ApiMessage[],
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Chat error ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          if (j.message?.content) yield j.message.content as string;
          if (j.done) return;
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function uploadFile(file: File): Promise<Omit<PendingAttachment, 'id'>> {
  const fd = new FormData();
  fd.append('file', file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/upload`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const d = JSON.parse(xhr.responseText);
        resolve({ filename: d.filename, type: d.type, text: d.text, base64: d.base64, mimeType: d.mime_type });
      } else {
        let msg = xhr.statusText;
        try { msg = JSON.parse(xhr.responseText).detail ?? msg; } catch { /* ignore */ }
        reject(new Error(`Upload failed: ${msg}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append('file', blob, `mic.${blob.type.includes('wav') ? 'wav' : 'webm'}`);
  const res = await fetch(`${API}/transcribe`, { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.detail ?? `Transcription failed (${res.status})`);
  }
  const data = await res.json();
  return (data.text ?? '') as string;
}

// RAG API
export interface KBDoc { doc_id: string; filename: string; chunks: number }
export interface KBChunk { text: string; filename: string; doc_id: string; score: number }

export async function ragIngest(doc_id: string, filename: string, text: string): Promise<{ chunks: number }> {
  const res = await fetch(`${API}/rag/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id, filename, text }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
  return res.json();
}

export async function ragListDocs(): Promise<KBDoc[]> {
  const res = await fetch(`${API}/rag/documents`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export async function ragDeleteDoc(doc_id: string): Promise<void> {
  await fetch(`${API}/rag/documents/${encodeURIComponent(doc_id)}`, { method: 'DELETE' });
}

export async function ragRetrieve(query: string, n_results = 6): Promise<KBChunk[]> {
  const res = await fetch(`${API}/rag/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, n_results }),
  });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  return data.chunks;
}

export function formatModelName(n: string) { return n.replace(/:latest$/, ''); }
export function formatModelSize(b: number) {
  const gb = b / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`;
}

export async function ragGetFullDoc(doc_id: string): Promise<{ doc_id: string; filename: string; text: string; chunks: number }> {
  const res = await fetch(`${API}/rag/document/${encodeURIComponent(doc_id)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  return res.json();
}

/**
 * Select files via Electron's native dialog (when running as desktop app)
 * or a hidden <input type="file"> (when running in a browser).
 * Returns File objects ready to pass to uploadFile().
 */
export async function selectFiles(multiple = true): Promise<File[]> {
  const electronAPI = (window as Window & { electronAPI?: { isElectron: boolean; selectFiles: (o: { multiple: boolean }) => Promise<{ name: string; buffer: string }[]> } }).electronAPI;

  if (electronAPI?.isElectron) {
    // Use native OS dialog — avoids Electron renderer sandbox restrictions
    const results = await electronAPI.selectFiles({ multiple });
    return results.map(r => {
      const bytes = atob(r.buffer);
      const arr   = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return new File([arr], r.name);
    });
  }

  // Browser fallback — programmatic input click
  return new Promise(resolve => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

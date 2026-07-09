import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { generateUUID } from "../utils/uuid";
import {
  Send, Square, Copy, Check, ChevronDown, Eraser, Bot,
  Pencil, PanelLeftOpen, PanelLeftClose,
  Paperclip, X, FileText, Image as ImgIcon, Loader2,
} from 'lucide-react';
import { useStore } from '../store';
import {
  streamChat, formatModelName, formatModelSize,
  uploadFile, ragIngest, ragRetrieve, ragGetFullDoc, selectFiles,
} from '../api/ollama';
import type { Message, OllamaModel, PendingAttachment } from '../types';

/*
This helper awaits the real Clipboard API and falls back to a hidden-textarea + execCommand
copy (which works in insecure contexts and older WebKit-based webviews), only reporting success 
when a copy actually happened
*/

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy fallback below
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
  const copy = async () => {
    const ok = await copyToClipboard(String(children).replace(/\n$/, ''));
    if (ok) { setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 2000); }
    else { setFailed(true); setTimeout(() => setFailed(false), 2000); }
  };
  return (
    <div className="relative group code-block-wrapper">
      {lang && <span className="code-block-lang">{lang}</span>}
      <button onClick={copy} title={failed ? 'Copy failed — select the text manually' : undefined}
        className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded px-2 py-0.5 text-xs flex items-center gap-1">
        {copied ? <Check size={10}/> : <Copy size={10}/>}{copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
      </button>
      <code className={className}>{children}</code>
    </div>
  );
}

function UserMessage({ msg, isDark, onEdit, disabled }: {
  msg: Message; isDark: boolean; onEdit: (id: string, c: string) => void; disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(msg.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  const open   = () => { setDraft(msg.content); setEditing(true); setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0); };
  const cancel = () => setEditing(false);
  const submit = () => { if (draft.trim()) { onEdit(msg.id, draft.trim()); setEditing(false); } };

  if (editing) return (
    <div className="flex justify-end mb-4">
      <div className="w-full max-w-[80%] flex flex-col gap-2">
        <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') cancel(); }}
          rows={Math.min(draft.split('\n').length + 1, 8)}
          className={`w-full text-sm rounded-2xl px-4 py-3 outline-none resize-none border ${isDark ? 'bg-zinc-700 text-zinc-100 border-violet-500/60' : 'bg-zinc-100 text-zinc-900 border-violet-400/60'}`} />
        <div className="flex justify-end gap-2">
          <button onClick={cancel} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-500 hover:text-zinc-700 hover:bg-black/5'}`}>Cancel</button>
          <button onClick={submit} disabled={!draft.trim()} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">Resend</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex justify-end mb-4 msg-animate group">
      {!disabled && (
        <button onClick={open} className={`self-start mt-2 mr-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-600 hover:bg-black/5'}`}><Pencil size={13}/></button>
      )}
      <div className="max-w-[80%] flex flex-col items-end gap-2">
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.images.map((b64, i) => <img key={i} src={`data:image/jpeg;base64,${b64}`} className="max-h-48 max-w-xs rounded-xl object-cover" alt="attached" />)}
          </div>
        )}
        {msg.attachmentNames && msg.attachmentNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {msg.attachmentNames.map((n, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${isDark ? 'bg-zinc-700/60 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}><FileText size={11}/>{n}</div>
            ))}
          </div>
        )}
        {msg.content && (
          <div className={`px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap break-words ${isDark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-900'}`}>{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ msg, isDark }: { msg: Message; isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    const ok = await copyToClipboard(msg.content);
    if (ok) { setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 2000); }
    else { setFailed(true); setTimeout(() => setFailed(false), 2000); }
  };
  return (
    <div className={`group flex gap-3 mb-6 msg-animate ${isDark ? '' : 'light-prose'}`}>
      <div className="shrink-0 w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center mt-0.5"><Bot size={14} className="text-white"/></div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium mb-1.5 flex items-center gap-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          <span>{formatModelName(msg.model)}</span>
          <span className="text-[10px]">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {msg.content === '' ? (
          <div className="flex items-center gap-1.5 py-1"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></div>
        ) : (
          <div className={`prose-chat text-sm ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}
              components={{
                code({ className, children }) { if (!className) return <code className={className}>{children}</code>; return <CodeBlock className={className}>{children}</CodeBlock>; },
                pre({ children }) { return <pre>{children}</pre>; },
              }}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
        {msg.content && (
          <button onClick={copy} title={failed ? 'Copy failed — select the text manually' : undefined}
            className={`mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs py-0.5 px-1.5 rounded ${isDark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}>
            {copied ? <Check size={11}/> : <Copy size={11}/>}{copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}

function ModelDropdown({ models, selected, onChange, isDark, disabled }: {
  models: OllamaModel[]; selected: string; onChange: (m: string) => void; isDark: boolean; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const btn  = isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50';
  const menu = isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200';
  const row  = isDark ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-zinc-50 text-zinc-700';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => !disabled && setOpen(v => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${btn} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <span>{formatModelName(selected) || 'Select model'}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && (
        <div className={`absolute left-0 top-full mt-1 w-72 rounded-xl border shadow-2xl overflow-hidden z-50 ${menu}`}>
          {models.map(m => (
            <button key={m.name} onClick={() => { onChange(m.name); setOpen(false); }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${row} ${m.name === selected ? 'bg-violet-600/10 text-violet-400' : ''}`}>
              <div className="flex flex-col items-start">
                <span className="font-medium">{formatModelName(m.name)}</span>
                {m.details?.parameter_size && <span className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>{m.details.parameter_size}{m.details.quantization_level ? ` · ${m.details.quantization_level}` : ''}</span>}
              </div>
              <span className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>{formatModelSize(m.size)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ att, onRemove, onAddToKB, isDark }: {
  att: PendingAttachment; onRemove: () => void;
  onAddToKB?: () => void; isDark: boolean;
}) {
  const [ingesting, setIngesting] = useState(false);
  const [ingested, setIngested]   = useState(false);

  const handleKB = async () => {
    if (!onAddToKB) return;
    setIngesting(true);
    onAddToKB();
    setIngested(true);
    setIngesting(false);
  };

  const bg = isDark ? 'bg-zinc-700 border-zinc-600 text-zinc-300' : 'bg-zinc-100 border-zinc-200 text-zinc-600';
  return (
    <div className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border text-xs ${bg}`}>
      {att.type === 'image' ? <ImgIcon size={11} className="text-violet-400 shrink-0"/> : <FileText size={11} className="text-violet-400 shrink-0"/>}
      <span className="max-w-[120px] truncate">{att.filename}</span>
      {att.type === 'document' && onAddToKB && !ingested && (
        <button onClick={handleKB} disabled={ingesting}
          title="Add to Knowledge Base for RAG"
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/40 transition-colors text-[10px]">
          {ingesting ? <Loader2 size={9} className="animate-spin"/> : null}
          {ingesting ? '…' : 'Add to KB'}
        </button>
      )}
      {ingested && <span className="text-[10px] text-emerald-400">✓ KB</span>}
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-zinc-600/40"><X size={10}/></button>
    </div>
  );
}

const ACCEPTED = [
  'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword','application/epub+zip',
  'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet',
  'text/plain','text/markdown','text/csv','text/html','application/json',
  'image/jpeg','image/png','image/gif','image/webp','image/bmp',
].join(',');

function InputBox({ onSend, onStop, isStreaming, disabled, isDark, attachments, onAttach, onRemoveAttachment, onAddToKB }: {
  onSend: (t: string) => void; onStop: () => void;
  isStreaming: boolean; disabled: boolean; isDark: boolean;
  attachments: PendingAttachment[];
  onAttach: (f: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onAddToKB: (att: PendingAttachment) => void;
}) {
  const [value, setValue]     = useState('');
  const [uploading, setUpl]   = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const submit = () => {
    const t = value.trim();
    if ((!t && attachments.length === 0) || disabled || isStreaming) return;
    onSend(t);
    setValue('');
    setTimeout(() => { if (textRef.current) { textRef.current.style.height = 'auto'; textRef.current.focus(); } }, 0);
  };

  const handleFile = async () => {
    setUpl(true);
    try {
      const files = await selectFiles(true);
      if (files.length) {
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        onAttach(dt.files);
      }
    } finally { setUpl(false); }
  };

  const border   = isDark ? 'bg-zinc-800 border-zinc-700 focus-within:border-zinc-500' : 'bg-white border-zinc-200 focus-within:border-zinc-400';
  const canSend  = (!!value.trim() || attachments.length > 0) && !disabled && !isStreaming && !uploading;

  return (
    <div className={`rounded-2xl border transition-colors overflow-hidden ${border}`}>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map(a => (
            <AttachmentChip key={a.id} att={a} isDark={isDark}
              onRemove={() => onRemoveAttachment(a.id)}
              onAddToKB={a.type === 'document' ? () => onAddToKB(a) : undefined} />
          ))}
        </div>
      )}
      <div className="relative flex items-end">
        <button onClick={handleFile} disabled={isStreaming || uploading}
          className={`shrink-0 self-end mb-2.5 ml-3 p-1.5 rounded-lg transition-colors
            ${uploading ? 'text-violet-400' : isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}
            ${isStreaming ? 'opacity-30 cursor-not-allowed' : ''}`}>
          {uploading ? <Loader2 size={15} className="animate-spin"/> : <Paperclip size={15}/>}
        </button>

        <textarea ref={textRef} rows={1} value={value}
          onChange={e => { setValue(e.target.value); resize(); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          disabled={isStreaming}
          className={`flex-1 bg-transparent outline-none text-sm leading-relaxed pl-2 pr-3 pt-3.5 pb-3.5 max-h-52 overflow-y-auto scrollbar-none ${isDark ? 'text-zinc-100 placeholder-zinc-600' : 'text-zinc-900 placeholder-zinc-400'}`}/>
        <div className="shrink-0 self-end mb-2.5 mr-3">
          {isStreaming
            ? <button onClick={onStop} className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDark ? 'bg-zinc-200 hover:bg-white text-zinc-900' : 'bg-zinc-800 hover:bg-black text-white'}`}><Square size={10} fill="currentColor"/></button>
            : <button onClick={submit} disabled={!canSend} className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all ${canSend ? 'bg-violet-600 hover:bg-violet-500 text-white' : isDark ? 'bg-zinc-700 text-zinc-600 cursor-not-allowed' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}><Send size={13}/></button>
          }
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ isDark, models }: { isDark: boolean; models: OllamaModel[] }) {
  return (
    <div className={`flex flex-col items-center justify-center h-full gap-6 px-8 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/30"><Bot size={28} className="text-white"/></div>
        <h1 className={`text-2xl font-semibold mb-1 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>LocalChat</h1>
        <p className="text-sm">{models.length > 0 ? `${models.length} model${models.length !== 1 ? 's' : ''} ready · fully offline` : 'Connecting…'}</p>
      </div>
      <p className={`text-sm ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>Send a message or attach a file to get started.</p>
    </div>
  );
}

export default function ChatArea({ chatId, sidebarOpen, onToggleSidebar }: {
  chatId: string; sidebarOpen: boolean; onToggleSidebar: () => void;
}) {
  const { chats, models, isStreaming, isDark, addMessage, updateLastMessage, setStreaming, updateChatModel, clearChat, editAndTruncate, useRAG, fullDocId, fullDocName, setFullDoc } = useStore();
  const activeChat = chats.find(c => c.id === chatId);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);
  const [pendingAttachments, setPending] = useState<PendingAttachment[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeChat?.messages.length, activeChat?.messages.at(-1)?.content]);

  const runStream = useCallback(async (model: string, apiMsgs: { role: 'user'|'assistant'; content: string; images?: string[] }[]) => {
    addMessage(chatId, { id: generateUUID(), role: 'assistant', content: '', model, timestamp: Date.now() });
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      let acc = '';
      for await (const chunk of streamChat(model, apiMsgs, ctrl.signal)) { acc += chunk; updateLastMessage(chatId, acc); }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      updateLastMessage(chatId, `⚠️ **Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally { setStreaming(false); abortRef.current = null; }
  }, [chatId, addMessage, updateLastMessage, setStreaming]);

  const handleSend = useCallback(async (content: string) => {
    if (isStreaming) return;
    const fresh = useStore.getState().chats.find(c => c.id === chatId);
    if (!fresh) return;

    let fullContent = content;
    const images: string[] = [];
    const names: string[]  = [];

    for (const att of pendingAttachments) {
      names.push(att.filename);
      if (att.type === 'document' && att.text) fullContent = `[Attached: ${att.filename}]\n\n${att.text}\n\n---\n\n${fullContent}`;
      else if (att.type === 'image' && att.base64) images.push(att.base64);
    }

    // Full document mode  send entire doc as context
    let ragSources: string[] = [];
    if (fullDocId && content.trim()) {
      try {
        const doc = await ragGetFullDoc(fullDocId);
        ragSources = [doc.filename];
        fullContent = `Full document: "${doc.filename}" (${doc.chunks} sections)\n\n${doc.text}\n\n---\n\nUsing the full document above, answer this: ${fullContent}`;
      } catch (err) {
        addMessage(chatId, { id: generateUUID(), role: 'assistant', content: `⚠️ **Could not load full document:** ${err instanceof Error ? err.message : String(err)}`, model: fresh.model, timestamp: Date.now() });
        setStreaming(false);
        return;
      }
    }
    // RAG: retrieve relevant chunks and inject as context
    else if (useRAG && content.trim()) {
      try {
        const chunks = await ragRetrieve(content, 5);
        if (chunks.length > 0) {
          ragSources = [...new Set(chunks.map(c => c.filename))];
          const ctx = chunks
            .map(c => `[Source: ${c.filename} | relevance: ${Math.round(c.score * 100)}%]\n${c.text}`)
            .join('\n\n---\n\n');
          fullContent = `The following context was retrieved from the knowledge base:\n\n${ctx}\n\n---\n\nUsing the context above, answer this question: ${fullContent}`;
        } else {
          console.warn('RAG: no chunks retrieved — KB may be empty or embedding failed');
        }
      } catch (err) {
        console.error('RAG retrieval error:', err);
        addMessage(chatId, {
          id: generateUUID(), role: 'assistant',
          content: `⚠️ **RAG retrieval failed:** ${err instanceof Error ? err.message : String(err)}\n\nMake sure \`nomic-embed-text\` is pulled: \`ollama pull nomic-embed-text\``,
          model: fresh.model, timestamp: Date.now(),
        });
        setStreaming(false);
        return;
      }
    }

    const prior = fresh.messages.map(m => ({ role: m.role as 'user'|'assistant', content: m.content, images: m.images }));
    const displayNames = [...names, ...ragSources.map(s => `🔍 ${s}`)];
    addMessage(chatId, { id: generateUUID(), role: 'user', content, model: fresh.model, timestamp: Date.now(), images: images.length ? images : undefined, attachmentNames: displayNames.length ? displayNames : undefined });
    setPending([]);

    await runStream(fresh.model, [...prior, { role: 'user', content: fullContent, images: images.length ? images : undefined }]);
  }, [chatId, isStreaming, addMessage, runStream, pendingAttachments, useRAG]);

  const handleEdit = useCallback(async (messageId: string, newContent: string) => {
    if (isStreaming) return;
    editAndTruncate(chatId, messageId, newContent);
    const fresh = useStore.getState().chats.find(c => c.id === chatId);
    if (!fresh) return;
    await runStream(fresh.model, fresh.messages.map(m => ({ role: m.role as 'user'|'assistant', content: m.content, images: m.images })));
  }, [chatId, isStreaming, editAndTruncate, runStream]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  // Model switch: update in place — no duplicate chat
  const handleModelChange = useCallback((newModel: string) => {
    updateChatModel(chatId, newModel);
  }, [chatId, updateChatModel]);

  const handleAttach = useCallback(async (files: FileList) => {
    const added: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      try { added.push({ ...await uploadFile(file), id: generateUUID() }); }
      catch (err) { console.error(`Upload failed for ${file.name}:`, err); }
    }
    setPending(prev => [...prev, ...added]);
  }, []);

  const handleAddToKB = useCallback(async (att: PendingAttachment) => {
    if (!att.text) return;
    try { await ragIngest(att.id, att.filename, att.text); }
    catch (err) { console.error('RAG ingest failed:', err); }
  }, []);

  if (!activeChat) return null;

  const hdr = isDark ? 'border-white/5 bg-surface-950/80' : 'border-black/5 bg-white/80';
  const bg  = isDark ? 'bg-surface-950' : 'bg-white';

  return (
    <div className={`flex flex-col h-full ${bg}`}>
      <header className={`flex items-center justify-between px-4 py-3 border-b backdrop-blur-sm sticky top-0 z-10 ${hdr}`}>
        <div className="flex items-center gap-3">
          <button onClick={onToggleSidebar} title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
            {sidebarOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}
          </button>
          <ModelDropdown models={models} selected={activeChat.model} onChange={handleModelChange} isDark={isDark} disabled={isStreaming}/>
          {isStreaming && <span className={`text-xs animate-pulse ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>Generating…</span>}
          {/* Active mode badge */}
          {!isStreaming && fullDocId && fullDocName && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border
              ${isDark ? 'bg-emerald-950/40 border-emerald-600/30 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
              <span>📄</span>
              <span className="max-w-[140px] truncate">{fullDocName}</span>
              <button onClick={() => setFullDoc(null, null)} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}
          {!isStreaming && useRAG && !fullDocId && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border
              ${isDark ? 'bg-violet-950/40 border-violet-600/30 text-violet-400' : 'bg-violet-50 border-violet-300 text-violet-700'}`}>
              <span>🔍</span> RAG active
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* RAG toggle */}
          <button onClick={() => clearChat(chatId)} disabled={isStreaming || activeChat.messages.length === 0}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors
              ${activeChat.messages.length === 0 || isStreaming ? isDark ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-300 cursor-not-allowed' : isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
            <Eraser size={13}/>Clear
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {activeChat.messages.length === 0
            ? <WelcomeScreen isDark={isDark} models={models}/>
            : activeChat.messages.map(msg => msg.role === 'user'
                ? <UserMessage key={msg.id} msg={msg} isDark={isDark} onEdit={handleEdit} disabled={isStreaming}/>
                : <AssistantMessage key={msg.id} msg={msg} isDark={isDark}/>)
          }
          <div ref={bottomRef}/>
        </div>
      </div>

      <div className={`px-4 pb-4 pt-2 ${bg}`}>
        <div className="max-w-2xl mx-auto">
          <InputBox onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} disabled={!activeChat.model}
            isDark={isDark} attachments={pendingAttachments} onAttach={handleAttach}
            onRemoveAttachment={id => setPending(p => p.filter(a => a.id !== id))}
            onAddToKB={handleAddToKB}/>
          <p className={`text-center text-[10px] mt-2 ${isDark ? 'text-zinc-700' : 'text-zinc-400'}`}>
            Running locally via Ollama · no data leaves your machine
          </p>
        </div>
      </div>
    </div>
  );
}

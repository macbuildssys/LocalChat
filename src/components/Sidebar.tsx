import { useState, useRef, useEffect } from 'react';
import { generateUUID } from "../utils/uuid";
import {
  MessageSquarePlus, Pencil, Trash2, Check, X,
  Sun, Moon, Database, ChevronDown, Upload, Loader2, ToggleLeft, ToggleRight, BookOpen, Settings,
} from 'lucide-react';
import { useStore } from '../store';
import { ragListDocs, ragDeleteDoc, uploadFile, ragIngest, selectFiles, type KBDoc } from '../api/ollama';

interface SidebarProps { onNewChat: () => void }

function groupChats(chats: { id: string; title: string; updatedAt: number }[]) {
  const now = Date.now(), day = 86_400_000;
  const g: Record<string, typeof chats> = { Today: [], Yesterday: [], 'Last 7 days': [], 'Last 30 days': [], Older: [] };
  for (const c of chats) {
    const age = now - c.updatedAt;
    if      (age < day)      g['Today'].push(c);
    else if (age < 2*day)    g['Yesterday'].push(c);
    else if (age < 7*day)    g['Last 7 days'].push(c);
    else if (age < 30*day)   g['Last 30 days'].push(c);
    else                     g['Older'].push(c);
  }
  return Object.entries(g).filter(([, v]) => v.length > 0);
}

function ChatItem({ id: _id, title, isActive, isDark, onSelect, onDelete, onRename }: {
  id: string; title: string; isActive: boolean; isDark: boolean;
  onSelect: () => void; onDelete: () => void; onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(title);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { setDraft(title); setTimeout(() => ref.current?.select(), 0); } }, [editing, title]);
  const commit = () => { onRename(draft); setEditing(false); };
  const cancel = () => { setEditing(false); setDraft(title); };

  const base = isDark
    ? `text-zinc-300 hover:bg-white/5 ${isActive ? 'bg-white/8 text-white' : ''}`
    : `text-zinc-600 hover:bg-black/5 ${isActive ? 'bg-black/6 text-zinc-900' : ''}`;

  return (
    <div className={`group relative flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${base}`}
      onClick={() => !editing && onSelect()}>
      {editing ? (
        <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
          <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
            className={`flex-1 text-sm bg-transparent outline-none border-b ${isDark ? 'border-violet-500 text-white' : 'border-violet-500 text-zinc-900'}`} />
          <button onClick={commit} className="text-violet-400 p-0.5"><Check size={13}/></button>
          <button onClick={cancel} className={`p-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}><X size={13}/></button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm truncate leading-snug">{title}</span>
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => setEditing(true)} className={`p-1 rounded ${isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}`}><Pencil size={12}/></button>
            <button onClick={onDelete} className="p-1 rounded text-zinc-500 hover:text-red-400"><Trash2 size={12}/></button>
          </div>
        </>
      )}
    </div>
  );
}

const KB_ACCEPT = [
  '.pdf','.docx','.doc','.epub','.odt','.ods','.odp',
  '.txt','.md','.rst','.csv','.json','.xml','.html','.htm','.rtf',
].join(',');

function KnowledgeBase({ isDark }: { isDark: boolean }) {
  const { useRAG, setUseRAG, fullDocId, setFullDoc } = useStore();
  const [open, setOpen]       = useState(false);
  const [docs, setDocs]       = useState<KBDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null); // filename being ingested
  const load = async () => {
    setLoading(true);
    try { setDocs(await ragListDocs()); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // load count on mount for badge

  const remove = async (doc_id: string) => {
    await ragDeleteDoc(doc_id);
    setDocs(d => d.filter(x => x.doc_id !== doc_id));
  };

  const handleUpload = async () => {
    const files = await selectFiles(true);
    if (!files.length) return;
    for (const file of files) {
      setUploading(file.name);
      try {
        const result = await uploadFile(file);
        if (result.type === 'document' && result.text) {
          await ragIngest(generateUUID(), result.filename, result.text);
        } else if (result.type === 'image') {
          console.warn('Images cannot be added to the KB — only text documents.');
        }
      } catch (err) {
        console.error(`KB ingest failed for ${file.name}:`, err);
      }
    }
    setUploading(null);
    await load();
  };

  const label  = isDark ? 'text-zinc-600' : 'text-zinc-400';
  const rowBg  = isDark ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-zinc-100 hover:bg-zinc-200';
  const border = isDark ? 'border-white/5' : 'border-black/5';

  return (
    <div className={`border-t ${border}`}>
      {/* Header row */}
      <button onClick={() => { setOpen(v => !v); if (!open) load(); }}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors
          ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}>
        <Database size={12}/>
        Knowledge Base
        {docs.length > 0 && (
          <span className="text-[10px] bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded-full">{docs.length}</span>
        )}
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">

          {/* RAG toggle */}
          <button onClick={() => setUseRAG(!useRAG)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
              ${useRAG
                ? 'bg-violet-600/15 border-violet-600/40 text-violet-400'
                : isDark ? 'bg-zinc-800/60 border-zinc-700 text-zinc-500 hover:text-zinc-300' : 'bg-zinc-100 border-zinc-200 text-zinc-400 hover:text-zinc-700'}`}>
            {useRAG ? <ToggleRight size={15} className="text-violet-400"/> : <ToggleLeft size={15}/>}
            {useRAG ? 'RAG enabled — KB is searched on every message' : 'RAG disabled — click to enable'}
          </button>

          {/* Upload button */}
          <button onClick={handleUpload} disabled={!!uploading}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
              ${isDark ? 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 hover:bg-white/5' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-black/5'}
              ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {uploading ? <Loader2 size={13} className="animate-spin"/> : <Upload size={13}/>}
            {uploading ? `Indexing ${uploading}…` : 'Upload document to KB'}
          </button>

          {/* Document list */}
          {loading ? (
            <p className={`text-xs px-1 ${label}`}>Loading…</p>
          ) : docs.length === 0 ? (
            <p className={`text-xs px-1 leading-relaxed ${label}`}>No documents yet. Upload a PDF, DOCX, or other text file above.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {docs.map(doc => (
                <div key={doc.doc_id} className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg ${rowBg}`}>
                  <span className={`flex-1 text-xs truncate ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{doc.filename}</span>
                  <span className={`text-[10px] shrink-0 ${label}`}>{doc.chunks} chunks</span>
                  <button onClick={() => remove(doc.doc_id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400 transition-all">
                    <X size={11}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function SettingsPanel({ isDark }: { isDark: boolean }) {
  const [open, setOpen]   = useState(false);
  const [host, setHost]   = useState('');
  const [saved, setSaved] = useState(false);
  const [envLock, setEnvLock] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/config')
      .then(r => r.json())
      .then(d => { setHost(d.ollama_host ?? ''); setEnvLock(d.env_override ?? false); })
      .catch(() => {});
  }, [open]);

  const save = async () => {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ollama_host: host }),
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
  };

  const border  = isDark ? 'border-white/5' : 'border-black/5';
  const panelBg = isDark ? 'bg-zinc-900 border-zinc-700 shadow-2xl' : 'bg-white border-zinc-200 shadow-xl';
  const inputBg = isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900';
  const label   = isDark ? 'text-zinc-400' : 'text-zinc-500';

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} title="Settings"
        className={`p-1.5 rounded-lg transition-colors
          ${open
            ? isDark ? 'text-zinc-200 bg-white/8' : 'text-zinc-700 bg-black/6'
            : isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
        <Settings size={14}/>
      </button>

      {open && (
        <div className={`absolute bottom-9 left-0 w-72 rounded-xl border p-4 z-50 ${panelBg}`}>
          <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${label}`}>Settings</p>

          <label className={`block text-xs mb-1 ${label}`}>Ollama Host</label>
          <input
            value={host}
            onChange={e => setHost(e.target.value)}
            disabled={envLock}
            placeholder="127.0.0.1:11434 or 192.168.1.x:11434"
            className={`w-full text-xs px-3 py-2 rounded-lg border outline-none font-mono mb-1 ${inputBg}
              ${envLock ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          {envLock && (
            <p className="text-[10px] text-amber-500 mb-2">
              Locked — OLLAMA_HOST env var is set and takes priority.
            </p>
          )}
          <p className={`text-[10px] mb-3 ${label}`}>
            IP or hostname only — no http:// prefix needed.
          </p>

          <button onClick={save} disabled={envLock || !host.trim()}
            className="w-full py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500
              text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {saved ? '✓ Saved — restart to apply' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ onNewChat }: SidebarProps) {
  const { chats, activeChatId, setActiveChat, deleteChat, renameChat, isDark, toggleTheme } = useStore();
  const groups    = groupChats([...chats].sort((a, b) => b.updatedAt - a.updatedAt));
  const sidebarBg = isDark ? 'bg-surface-900 border-white/5' : 'bg-surface-50 border-black/5';
  const label     = isDark ? 'text-zinc-600' : 'text-zinc-400';

  return (
    <div className={`flex flex-col h-full w-64 border-r ${sidebarBg}`}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">L</span>
        </div>
        <span className={`text-sm font-semibold tracking-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}>LocalChat</span>
      </div>

      <div className="px-3 pb-2">
        <button onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors">
          <MessageSquarePlus size={15}/>New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {groups.length === 0
          ? <div className={`text-xs text-center py-8 ${label}`}>No chats yet</div>
          : groups.map(([lbl, items]) => (
            <div key={lbl} className="mb-2">
              <div className={`text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 ${label}`}>{lbl}</div>
              {items.map(c => (
                <ChatItem key={c.id} id={c.id} title={c.title} isActive={c.id === activeChatId}
                  isDark={isDark} onSelect={() => setActiveChat(c.id)}
                  onDelete={() => deleteChat(c.id)} onRename={t => renameChat(c.id, t)}/>
              ))}
            </div>
          ))
        }
      </div>

      <KnowledgeBase isDark={isDark}/>

      <div className={`border-t px-3 py-3 flex items-center justify-between ${isDark ? 'border-white/5' : 'border-black/5'}`}>
        <span className={`text-xs ${label}`}>{chats.length} chat{chats.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <SettingsPanel isDark={isDark}/>
          <button onClick={toggleTheme}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
            {isDark ? <Sun size={14}/> : <Moon size={14}/>}
          </button>
        </div>
      </div>
    </div>
  );
}

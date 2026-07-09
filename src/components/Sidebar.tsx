import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { generateUUID } from "../utils/uuid";
import {
  MessageSquarePlus, Pencil, Trash2, Check, X,
  Sun, Moon, Database, ChevronDown, Upload, Loader2, ToggleLeft, ToggleRight, BookOpen, Settings,
  FolderPlus, Folder, FolderOpen, MoreHorizontal, FolderInput,
} from 'lucide-react';
import { useStore } from '../store';
import { ragListDocs, ragDeleteDoc, uploadFile, ragIngest, selectFiles, type KBDoc } from '../api/ollama';

interface SidebarProps { onNewChat: () => void }

function groupChats(chats: { id: string; title: string; updatedAt: number; projectId?: string | null }[]) {
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

/*
A dropdown menu rendered into document.body via portal, positioned against a trigger 
element's bounding rect. This is what keeps popovers from being clipped by the sidebar's 
`overflow-hidden` collapse wrapper in App.tsx.
*/

function PortalMenu({ anchorRef, isDark, onClose, children, align = 'left' }: {
  anchorRef: React.RefObject<HTMLElement>; isDark: boolean; onClose: () => void;
  children: React.ReactNode; align?: 'left' | 'right';
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(align === 'right'
      ? { top: rect.bottom + 4, left: rect.right }
      : { top: rect.bottom + 4, left: rect.left });
  }, [anchorRef, align]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [anchorRef, onClose]);

  if (!pos) return null;
  const menu = isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200';
  const style: React.CSSProperties = align === 'right'
    ? { top: pos.top, right: window.innerWidth - pos.left }
    : { top: pos.top, left: pos.left };

  return createPortal(
    <div ref={menuRef} style={style} className={`fixed w-56 rounded-xl border shadow-2xl overflow-hidden z-[100] ${menu}`}>
      {children}
    </div>,
    document.body
  );
}

function ChatItem({ id: _id, title, isActive, isDark, onSelect, onDelete, onRename, projects, currentProjectId, onMove }: {
  id: string; title: string; isActive: boolean; isDark: boolean;
  onSelect: () => void; onDelete: () => void; onRename: (t: string) => void;
  projects: { id: string; name: string }[]; currentProjectId?: string | null;
  onMove: (projectId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(title);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { setDraft(title); setTimeout(() => ref.current?.select(), 0); } }, [editing, title]);
  const commit = () => { onRename(draft); setEditing(false); };
  const cancel = () => { setEditing(false); setDraft(title); };

  const base = isDark
    ? `text-zinc-300 hover:bg-white/5 ${isActive ? 'bg-white/8 text-white' : ''}`
    : `text-zinc-600 hover:bg-black/5 ${isActive ? 'bg-black/6 text-zinc-900' : ''}`;
  const row = isDark ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-zinc-50 text-zinc-700';

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
            <button ref={moveBtnRef} onClick={() => setMoveOpen(v => !v)} title="Move to project"
              className={`p-1 rounded ${isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}`}><FolderInput size={12}/></button>
            <button onClick={() => setEditing(true)} className={`p-1 rounded ${isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}`}><Pencil size={12}/></button>
            <button onClick={onDelete} className="p-1 rounded text-zinc-500 hover:text-red-400"><Trash2 size={12}/></button>
          </div>
          {moveOpen && (
            <PortalMenu anchorRef={moveBtnRef} isDark={isDark} onClose={() => setMoveOpen(false)}>
              {currentProjectId && (
                <button onClick={() => { onMove(null); setMoveOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${row}`}>
                  <X size={12}/>Remove from project
                </button>
              )}
              {projects.length === 0 ? (
                <p className={`px-3 py-2 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>No projects yet</p>
              ) : projects.map(p => (
                <button key={p.id} onClick={() => { onMove(p.id); setMoveOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${row} ${p.id === currentProjectId ? 'text-violet-400' : ''}`}>
                  <Folder size={12}/><span className="truncate">{p.name}</span>
                </button>
              ))}
            </PortalMenu>
          )}
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
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
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

  const panelBg = isDark ? 'bg-zinc-900 border-zinc-700 shadow-2xl' : 'bg-white border-zinc-200 shadow-xl';
  const inputBg = isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900';
  const label   = isDark ? 'text-zinc-400' : 'text-zinc-500';

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(v => !v)} title="Settings"
        className={`p-1.5 rounded-lg transition-colors
          ${open
            ? isDark ? 'text-zinc-200 bg-white/8' : 'text-zinc-700 bg-black/6'
            : isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
        <Settings size={14}/>
      </button>

      {/* Rendered via portal + fixed positioning so it always shows in full,
          instead of being clipped by the sidebar's overflow-hidden collapse wrapper. */}
      {open && pos && createPortal(
        <div ref={panelRef} style={{ bottom: pos.bottom, left: pos.left }}
          className={`fixed w-72 rounded-xl border p-4 z-[100] ${panelBg}`}>
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
        </div>,
        document.body
      )}
    </>
  );
}

function ProjectRow({ project, isDark }: { project: { id: string; name: string }; isDark: boolean }) {
  const { chats, activeChatId, setActiveChat, deleteChat, renameChat, createChat, models, lastUsedModel,
          projects, moveChatToProject, deleteProject, renameProject } = useStore();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const myChats = chats.filter(c => c.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const modelExists = lastUsedModel && models.some(m => m.name === lastUsedModel);
  const defaultModel = (modelExists ? lastUsedModel : models[0]?.name) ?? '';

  const label = isDark ? 'text-zinc-600' : 'text-zinc-400';
  const row = isDark ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-zinc-50 text-zinc-700';

  const commitRename = () => { renameProject(project.id, draft); setEditing(false); };

  return (
    <div className="mb-1">
      <div className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
        onClick={() => setOpen(v => !v)}>
        {open ? <FolderOpen size={13} className="text-violet-400 shrink-0"/> : <Folder size={13} className="text-violet-400 shrink-0"/>}
        {editing ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
            onBlur={commitRename}
            className={`flex-1 text-sm bg-transparent outline-none border-b ${isDark ? 'border-violet-500 text-white' : 'border-violet-500 text-zinc-900'}`} />
        ) : (
          <span className={`flex-1 text-sm truncate font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{project.name}</span>
        )}
        <span className={`text-[10px] shrink-0 ${label}`}>{myChats.length}</span>
        <button ref={menuBtnRef} onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className={`shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 ${isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}`}>
          <MoreHorizontal size={13}/>
        </button>
        {menuOpen && (
          <PortalMenu anchorRef={menuBtnRef} isDark={isDark} onClose={() => setMenuOpen(false)}>
            <button onClick={() => { setEditing(true); setMenuOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${row}`}><Pencil size={12}/>Rename</button>
            <button onClick={() => { deleteProject(project.id, false); setMenuOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${row}`}><FolderInput size={12}/>Delete project, keep chats</button>
            <button onClick={() => { deleteProject(project.id, true); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-red-400 hover:bg-red-500/10"><Trash2 size={12}/>Delete project and chats</button>
          </PortalMenu>
        )}
      </div>

      {open && (
        <div className="pl-4">
          <button onClick={() => createChat(defaultModel, project.id)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs mb-0.5 ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
            <MessageSquarePlus size={12}/>New chat in project
          </button>
          {myChats.length === 0 ? (
            <p className={`text-[11px] px-3 py-1 ${label}`}>No chats yet</p>
          ) : myChats.map(c => (
            <ChatItem key={c.id} id={c.id} title={c.title} isActive={c.id === activeChatId}
              isDark={isDark} onSelect={() => setActiveChat(c.id)}
              onDelete={() => deleteChat(c.id)} onRename={t => renameChat(c.id, t)}
              projects={projects} currentProjectId={c.projectId} onMove={pid => moveChatToProject(c.id, pid)}/>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectsSection({ isDark }: { isDark: boolean }) {
  const { projects, createProject } = useStore();
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const label = isDark ? 'text-zinc-600' : 'text-zinc-400';

  const submit = () => {
    if (draft.trim()) createProject(draft.trim());
    setDraft(''); setCreating(false);
  };

  return (
    <div className="px-2 pt-1">
      <div className="flex items-center gap-1 px-1 mb-1">
        <button onClick={() => setOpen(v => !v)}
          className={`flex-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest px-2 py-1.5 rounded-lg ${label} ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
          <ChevronDown size={11} className={`transition-transform ${open ? '' : '-rotate-90'}`}/>Projects
        </button>
        <button onClick={() => { setCreating(true); setOpen(true); }} title="New project"
          className={`p-1 rounded ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
          <FolderPlus size={13}/>
        </button>
      </div>

      {open && (
        <>
          {creating && (
            <div className="flex items-center gap-1 px-2 py-1 mb-1">
              <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setDraft(''); setCreating(false); } }}
                onBlur={submit} placeholder="Project name…"
                className={`flex-1 text-sm bg-transparent outline-none border-b px-1 ${isDark ? 'border-violet-500 text-white' : 'border-violet-500 text-zinc-900'}`} />
            </div>
          )}
          {projects.length === 0 && !creating ? (
            <p className={`text-xs px-3 py-1 mb-1 ${label}`}>No projects yet — group related chats together.</p>
          ) : projects.map(p => <ProjectRow key={p.id} project={p} isDark={isDark}/>)}
        </>
      )}
    </div>
  );
}

export default function Sidebar({ onNewChat }: SidebarProps) {
  const { chats, activeChatId, setActiveChat, deleteChat, renameChat, isDark, toggleTheme, projects, moveChatToProject } = useStore();
  // Only chats with no project show up in the flat Today/Yesterday list —
  // chats inside a project live under that project instead.
  const unfiledChats = chats.filter(c => !c.projectId);
  const groups    = groupChats([...unfiledChats].sort((a, b) => b.updatedAt - a.updatedAt));
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
        <ProjectsSection isDark={isDark}/>

        <div className={`mt-1 mb-1 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}/>

        {groups.length === 0
          ? <div className={`text-xs text-center py-8 ${label}`}>No chats yet</div>
          : groups.map(([lbl, items]) => (
            <div key={lbl} className="mb-2">
              <div className={`text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 ${label}`}>{lbl}</div>
              {items.map(c => (
                <ChatItem key={c.id} id={c.id} title={c.title} isActive={c.id === activeChatId}
                  isDark={isDark} onSelect={() => setActiveChat(c.id)}
                  onDelete={() => deleteChat(c.id)} onRename={t => renameChat(c.id, t)}
                  projects={projects} currentProjectId={c.projectId} onMove={pid => moveChatToProject(c.id, pid)}/>
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

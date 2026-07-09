import { useEffect, useState } from 'react';
import { AlertTriangle, PanelLeftOpen } from 'lucide-react';
import { useStore } from './store';
import { fetchModels } from './api/ollama';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';

function ErrorBanner({ message, isDark }: { message: string; isDark: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 text-sm border-b
      ${isDark ? 'bg-amber-950/30 border-amber-900/30 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
      <AlertTriangle size={15} className="shrink-0" /><span>{message}</span>
    </div>
  );
}

export default function App() {
  const { isDark, models, setModels, chats, activeChatId, setActiveChat, createChat, ollamaError, setOllamaError, lastUsedModel } = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);

  useEffect(() => {
    fetchModels()
      .then(ms => { setModels(ms); setOllamaError(null); })
      .catch((e: Error) => setOllamaError(`Could not connect to Ollama: ${e.message}`));
  }, [setModels, setOllamaError]);

  useEffect(() => {
    if (!activeChatId && chats.length > 0) setActiveChat(chats[0].id);
  }, [activeChatId, chats, setActiveChat]);

  // Keep using whichever model the user last picked, even for brand-new chats,
  // instead of silently resetting to the first model Ollama happens to list.
  const modelStillExists = lastUsedModel && models.some(m => m.name === lastUsedModel);
  const defaultModel = (modelStillExists ? lastUsedModel : models[0]?.name) ?? '';
  const handleNewChat = () => createChat(defaultModel);
  const toggle        = () => setSidebarOpen(v => !v);

  const bg   = isDark ? 'bg-surface-950' : 'bg-white';
  const text = isDark ? 'text-zinc-100'  : 'text-zinc-900';

  return (
    <div className={`flex h-screen overflow-hidden ${bg} ${text}`}>

      {/* Sidebar — overflow-hidden clips content when width → 0 */}
      <div className={`flex-shrink-0 overflow-hidden transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-0'}`}>
        <Sidebar onNewChat={handleNewChat} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {ollamaError && <ErrorBanner message={ollamaError} isDark={isDark} />}

        {activeChatId ? (
          <ChatArea chatId={activeChatId} sidebarOpen={sidebarOpen} onToggleSidebar={toggle} />
        ) : (
          /* No-chat empty state — still shows sidebar toggle */
          <div className={`flex-1 flex flex-col ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            <div className={`flex items-center px-4 py-3 border-b ${isDark ? 'border-white/5' : 'border-black/5'}`}>
              <button onClick={toggle}
                className={`p-1.5 rounded-lg transition-colors
                  ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-700 hover:bg-black/5'}`}>
                <PanelLeftOpen size={17} />
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <p className="text-sm">No chats yet.</p>
              <button onClick={handleNewChat}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors">
                Start a new chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

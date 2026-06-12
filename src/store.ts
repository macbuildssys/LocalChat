import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatSession, Message, OllamaModel } from './types';

interface AppState {
  chats: ChatSession[];
  activeChatId: string | null;
  models: OllamaModel[];
  isStreaming: boolean;
  isDark: boolean;
  ollamaError: string | null;
  useRAG: boolean;
  fullDocId: string | null;   // doc_id selected for full analysis
  fullDocName: string | null; // filename for display

  createChat: (model: string) => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  setActiveChat: (id: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateLastMessage: (chatId: string, content: string) => void;
  editAndTruncate: (chatId: string, messageId: string, newContent: string) => void;
  setModels: (models: OllamaModel[]) => void;
  setStreaming: (v: boolean) => void;
  toggleTheme: () => void;
  setOllamaError: (err: string | null) => void;
  updateChatModel: (chatId: string, model: string) => void;
  clearChat: (id: string) => void;
  setUseRAG: (v: boolean) => void;
  setFullDoc: (id: string | null, name: string | null) => void;
}

// export const useStore = create<AppState>()(
//   persist(
//     (set, get) => ({
//       chats: [],
//       activeChatId: null,
//       models: [],
//       isStreaming: false,
//       isDark: true,
//       ollamaError: null,
//       useRAG: false,
//       fullDocId: null,
//       fullDocName: null,

//       createChat: (model) => {
//         const id = crypto.randomUUID();
//         set(s => ({ chats: [{ id, title: 'New Chat', model, messages: [], createdAt: Date.now(), updatedAt: Date.now() }, ...s.chats], activeChatId: id }));
//         return id;
//       },
export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      models: [],
      isStreaming: false,
      isDark: true,
      ollamaError: null,
      useRAG: false,
      fullDocId: null,
      fullDocName: null,

      createChat: (model) => {
        const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        set(s => ({ chats: [{ id, title: 'New Chat', model, messages: [], createdAt: Date.now(), updatedAt: Date.now() }, ...s.chats], activeChatId: id }));
        return id;
      },

  
      deleteChat: (id) => set(s => {
        const chats = s.chats.filter(c => c.id !== id);
        return { chats, activeChatId: s.activeChatId === id ? (chats[0]?.id ?? null) : s.activeChatId };
      }),

      renameChat: (id, title) => set(s => ({ chats: s.chats.map(c => c.id === id ? { ...c, title: title.trim() || c.title } : c) })),
      setActiveChat: (id) => set({ activeChatId: id }),

      addMessage: (chatId, message) => set(s => ({
        chats: s.chats.map(c => {
          if (c.id !== chatId) return c;
          const title = c.messages.length === 0 && message.role === 'user'
            ? message.content.slice(0, 50).trim() || 'New Chat' : c.title;
          return { ...c, title, messages: [...c.messages, message], updatedAt: Date.now() };
        }),
      })),

      updateLastMessage: (chatId, content) => set(s => ({
        chats: s.chats.map(c => {
          if (c.id !== chatId) return c;
          const msgs = [...c.messages];
          const last = msgs.at(-1);
          if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content };
          return { ...c, messages: msgs };
        }),
      })),

      editAndTruncate: (chatId, messageId, newContent) => set(s => ({
        chats: s.chats.map(c => {
          if (c.id !== chatId) return c;
          const idx = c.messages.findIndex(m => m.id === messageId);
          if (idx === -1) return c;
          return { ...c, messages: [...c.messages.slice(0, idx), { ...c.messages[idx], content: newContent.trim() }], updatedAt: Date.now() };
        }),
      })),

      setModels: (models) => set({ models }),
      setStreaming: (v) => set({ isStreaming: v }),
      toggleTheme: () => set(s => ({ isDark: !s.isDark })),
      setOllamaError: (err) => set({ ollamaError: err }),
      updateChatModel: (chatId, model) => set(s => ({ chats: s.chats.map(c => c.id === chatId ? { ...c, model } : c) })),
      clearChat: (id) => set(s => ({ chats: s.chats.map(c => c.id === id ? { ...c, messages: [], title: 'New Chat', updatedAt: Date.now() } : c) })),
      setUseRAG: (v) => set({ useRAG: v, ...(v ? { fullDocId: null, fullDocName: null } : {}) }),
      setFullDoc: (id, name) => set({ fullDocId: id, fullDocName: name, ...(id ? { useRAG: false } : {}) }),
    }),
    {
      name: 'localchat-v1',
      partialize: s => ({ chats: s.chats, activeChatId: s.activeChatId, isDark: s.isDark, useRAG: s.useRAG }),
    }
  )
);

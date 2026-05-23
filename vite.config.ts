import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ollamaHost = process.env.OLLAMA_HOST
  ? process.env.OLLAMA_HOST.startsWith('http')
    ? process.env.OLLAMA_HOST
    : `http://${process.env.OLLAMA_HOST}:11434`
  : 'http://localhost:11434';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev mode proxy /api/ to the FastAPI backend running on :8765
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
      // Legacy direct-Ollama proxy kept for fallback
      '/ollama': {
        target: ollamaHost,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
  preview: {
    port: 5173,
  },
});

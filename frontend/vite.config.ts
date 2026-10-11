import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // "@/components/..." means "src/components/..." (shorter than ../../..)
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Any browser request to /api/* is forwarded to the Express backend.
    // The browser only ever talks to localhost:5173, so there are no CORS problems
    // and (from Phase 1) login cookies just work.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})

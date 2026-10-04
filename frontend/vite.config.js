import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  server: {
    proxy: {
      '/health': 'http://localhost:8000',
      '/agents': 'http://localhost:8000',
      '/notarize': 'http://localhost:8000',
      '/verify': 'http://localhost:8000',
      '/proofs': 'http://localhost:8000',
    }
  }
})

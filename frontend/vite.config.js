import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  // Backend opsiyoneldir (VITE_API_URL); v1 REST proxy'leri kaldırıldı.
})

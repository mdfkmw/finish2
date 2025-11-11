import { fileURLToPath, URL } from 'url';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
    resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',   // ascultă pe toate interfețele, nu doar localhost
    port: 5173,         // portul implicit, sau ce port folosești tu
    allowedHosts: 'all',
    proxy: {
      // toate cererile la /api/* să meargă la backend-ul tău
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        rewrite: path => path
      }
    },
  },
})

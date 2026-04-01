import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/analytics',
  server: {
    port: 5173,
    proxy: {
      '/vendor-analytics': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/cogs-analytics': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})

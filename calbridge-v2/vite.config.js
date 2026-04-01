import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/v2',
  server: {
    port: 5174,
    proxy: {
      '/vendor-analytics': { target: 'http://localhost:3000', changeOrigin: true },
      '/v2-analytics':     { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})

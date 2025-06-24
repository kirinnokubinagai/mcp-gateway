import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: 3002,
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:3003',
        changeOrigin: true
      }
    }
  }
})
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
    port: Number(process.env.MCP_WEB_PORT) || 3002,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.MCP_API_PORT || 3003}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://localhost:${process.env.MCP_API_PORT || 3003}`,
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: Number(process.env.MCP_WEB_PORT) || 3002,
    proxy: {
      '/api': {
        target: process.env.API_URL || `http://mcp-gateway-server:${process.env.MCP_API_PORT || 3003}`,
        changeOrigin: true
      },
      '/ws': {
        target: process.env.WS_URL || `ws://mcp-gateway-server:${process.env.MCP_API_PORT || 3003}`,
        ws: true,
        changeOrigin: true
      }
    }
  }
})
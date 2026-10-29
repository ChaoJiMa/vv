import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 把体积大的第三方库拆成独立 chunk,利于浏览器缓存
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    // 监听 0.0.0.0，同网段手机/其它设备可用本机 IP 访问
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // 用 127.0.0.1，避免 Windows 上 localhost→::1 而 wrangler 只绑 IPv4 时代理 ECONNREFUSED
      '/api': 'http://127.0.0.1:8787',
      '/auth': 'http://127.0.0.1:8787',
    },
  },
})

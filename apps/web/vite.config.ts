import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' thay vì 'autoUpdate' — tránh service worker mới tự reload ngầm giữa lúc
      // học viên đang làm bài thi (chỉ áp dụng bản mới ở lần tải trang tự nhiên tiếp theo).
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: {
        name: '3800Quiz',
        short_name: '3800Quiz',
        description: 'Hệ thống quiz/kiểm tra nội bộ',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#EEF2FF',
        theme_color: '#1565C0',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // CHỈ precache asset tĩnh build ra — KHÔNG khai báo runtimeCaching cho /api hay /socket.io,
        // đây là điểm mấu chốt đảm bảo mọi gọi API luôn ra mạng thật (network-only), giữ đúng
        // nguyên tắc "online-first thuần" của dự án — không cache đề thi/điểm số dưới bất kỳ hình thức nào.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 15174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:13011',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'ws://localhost:13011',
        ws: true,
      },
    },
  },
})

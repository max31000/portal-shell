import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  // Dev only: proxy service paths to production so the shell can be developed
  // against real apps (they become same-origin through the proxy).
  server: {
    proxy: Object.fromEntries(
      ['/cashpulse', '/bonds', '/credit_calc', '/auth'].map((p) => [
        p,
        { target: 'https://mvv42.ru', changeOrigin: true, secure: true },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['src/test/setup.ts'],
  },
})

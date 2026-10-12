import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { mvv42Html } from '@mvv42/kit/vite'

export default defineConfig({
  // mvv42Html(): the shared anti-flash colour-scheme script (`mvv42-color-scheme`) in <head>.
  plugins: [react(), mvv42Html()],
  resolve: {
    dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks', '@mantine/notifications'],
  },
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
    // Modal transitions in admin flows are slow on CI runners.
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['src/test/setup.ts'],
  },
})

/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Only run tests from source; ignore compiled output under dist*/
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-*', '.dist-*', '.wrangler'],
  },
})

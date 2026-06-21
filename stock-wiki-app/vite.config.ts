import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // prevent vite from obscuring Rust errors
  clearScreen: false,
  server: {
    strictPort: true,
  },
})

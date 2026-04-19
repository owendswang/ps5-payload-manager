import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    minify: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000, // Inline all assets
  }
})

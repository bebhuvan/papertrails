// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  build: {
    // Optimize for Cloudflare Pages
    inlineStylesheets: 'auto'
  },
  vite: {
    build: {
      // Reduce memory usage during build
      rollupOptions: {
        output: {
          manualChunks: undefined
        }
      }
    }
  }
});

// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://papertrails.rabbitholes.garden',
  build: {
    // Optimize for Cloudflare Pages - force inline styles for better Speed Index
    inlineStylesheets: 'always'
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

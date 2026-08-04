import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  plugins: [react(), svgr()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    port: 3002,
    strictPort: true
  },
  preview: {
    port: 3002,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/testSetup.js',
    server: {
      deps: {
        inline: ['@network-survey/frontend-react']
      }
    }
  },
  resolve: {
    // Resolve peer dependencies from the consuming workspace rather than the
    // real path of file: workspace packages.
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    // Linked workspace packages can hide CommonJS dependencies from Vite's
    // initial scan. Pre-bundle them for browser-safe ESM during local review.
    include: ['prop-types', 'react-is', 'react-redux', 'hoist-non-react-statics']
  }
});

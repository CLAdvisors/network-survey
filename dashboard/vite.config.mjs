import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const jsAsJsx = () => ({
  name: 'dashboard-js-as-jsx',
  async transform(code, id) {
    if (!/dashboard\/src\/.*\.js$/.test(id)) {
      return null;
    }

    return transformWithEsbuild(code, id, {
      loader: 'jsx',
      jsx: 'automatic'
    });
  }
});

export default defineConfig({
  plugins: [jsAsJsx(), react(), svgr()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    port: 3001,
    strictPort: true
  },
  preview: {
    port: 3001,
    strictPort: true
  },
  resolve: {
    // Resolve peer dependencies from the consuming workspace rather than the
    // real path of file: workspace packages.
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    // Linked workspace packages can hide CommonJS dependencies from Vite's
    // initial scan. Pre-bundle the React Redux CJS chain for browser-safe ESM.
    include: ['prop-types', 'react-is', 'react-redux', 'hoist-non-react-statics'],
    esbuildOptions: {
      loader: {
        '.js': 'jsx'
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true
  }
});

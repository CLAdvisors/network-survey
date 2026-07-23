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
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
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

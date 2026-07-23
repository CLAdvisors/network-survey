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
  resolve: {
    dedupe: ['react', 'react-dom']
  }
});

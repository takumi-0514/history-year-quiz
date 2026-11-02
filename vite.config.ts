import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// When deployed on GitHub Pages under https://<username>.github.io/<repo>/,
// the base must be '/history-year-quiz/'. In local dev or AI Studio, default to './'.
const isGitHub = process.env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_PAGES === 'true';
const base = isGitHub ? '/history-year-quiz/' : './';

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});

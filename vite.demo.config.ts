import { defineConfig } from 'vite';

// A self-contained trusted local fixture; no URL proxy or remote-page execution.
export default defineConfig({ build: { outDir: 'demo-dist' } });

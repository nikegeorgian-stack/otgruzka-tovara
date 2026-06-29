import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appBuildOptions } from '../vite.chunkConfig'

const repoRoot = path.resolve(__dirname, '..')

export default defineConfig({
  root: path.resolve(__dirname),
  envDir: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
    },
  },
  define: {
    'import.meta.env.VITE_FST_WEB': JSON.stringify('true'),
  },
  server: {
    port: 5173,
    fs: {
      // Общий src/ лежит на уровень выше — нужен для стилей и HMR
      allow: [repoRoot],
    },
  },
  build: {
    ...appBuildOptions(),
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})

import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appBuildOptions } from '../vite.chunkConfig'

const repoRoot = path.resolve(__dirname, '..')

/** Capacitor/Android: относительные пути ассетов (file/https схема WebView). */
const capacitorBuild = process.env.CAPACITOR_BUILD === '1'

export default defineConfig({
  root: path.resolve(__dirname),
  envDir: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, 'public'),
  base: capacitorBuild ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
      '@fst/dataconnect-admin-generated': path.resolve(__dirname, 'src/blocked-admin-sdk.ts'),
    },
  },
  define: {
    'import.meta.env.VITE_FST_WEB': JSON.stringify('true'),
    /** Прод Otgruzka: единый стор = SQL Connect (не Firestore blob). */
    'import.meta.env.VITE_FST_PERSISTENCE': JSON.stringify('sqlconnect'),
  },
  server: {
    port: 5173,
    fs: {
      // Общий src/ лежит на уровень выше — нужен для стилей и HMR
      allow: [repoRoot],
    },
  },
  optimizeDeps: {
    include: ['@vladmandic/face-api'],
  },
  build: {
    ...appBuildOptions(),
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})

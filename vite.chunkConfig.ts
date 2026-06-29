import type { UserConfig } from 'vite'

/** Общие настройки code-splitting для desktop и fst-web. */
export function appBuildOptions(): UserConfig['build'] {
  return {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'vendor-firebase'
          if (id.includes('/xlsx') || id.includes('\\xlsx')) return 'vendor-xlsx'
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf'
          if (id.includes('qrcode') || id.includes('jsbarcode')) return 'vendor-codes'
          if (
            id.includes('react-dom') ||
            id.includes('/react/') ||
            id.includes('\\react\\')
          ) {
            return 'vendor-react'
          }
        },
      },
    },
  }
}

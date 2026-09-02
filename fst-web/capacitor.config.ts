import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APK — оболочка: UI всегда с продакшена.
 * Деплой на Vercel = обновление для телефонов без новой установки APK.
 * Новый APK нужен только при смене иконки, native-плагинов (push и т.п.).
 */
const LIVE_URL = 'https://otgruzka-tovara.vercel.app'

const config: CapacitorConfig = {
  appId: 'net.fibercell.fst',
  appName: 'Отгрузка товаров',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    url: LIVE_URL,
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#faf8f4',
    },
  },
}

export default config

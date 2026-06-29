import type { AiSettings } from '@/lib/types'

export type AiProviderId = 'off' | 'local' | 'openai' | 'gemini' | 'kimi' | 'custom'

export type AiProviderPreset = {
  id: AiProviderId
  baseUrl: string
  model: string
  keyPlaceholder: string
}

export const AI_PROVIDER_PRESETS: Record<Exclude<AiProviderId, 'custom'>, AiProviderPreset> = {
  off: {
    id: 'off',
    baseUrl: '',
    model: '',
    keyPlaceholder: '',
  },
  local: {
    id: 'local',
    baseUrl: 'local',
    model: 'local',
    keyPlaceholder: '',
  },
  openai: {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPlaceholder: 'sk-…',
  },
  gemini: {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash-lite',
    keyPlaceholder: 'AIza… / AQ…',
  },
  kimi: {
    id: 'kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.5',
    keyPlaceholder: 'sk-…',
  },
}

export const AI_PROVIDER_IDS: AiProviderId[] = ['off', 'local', 'openai', 'gemini', 'kimi', 'custom']

export function normalizeAiProvider(ai: AiSettings | undefined): AiProviderId {
  if (ai?.provider) return ai.provider
  if (ai?.enabled === false) return 'off'
  const url = (ai?.baseUrl ?? '').toLowerCase()
  if (url === 'local') return 'local'
  if (url.includes('generativelanguage') || url.includes('gemini')) return 'gemini'
  if (url.includes('moonshot')) return 'kimi'
  if (ai?.enabled && ai?.apiKey?.trim()) return 'openai'
  return 'local'
}

export function isAiActive(ai: AiSettings | undefined): boolean {
  return normalizeAiProvider(ai) !== 'off'
}

export function isLocalAiProvider(ai: AiSettings | undefined): boolean {
  return normalizeAiProvider(ai) === 'local'
}

export function applyProviderPreset(
  current: AiSettings | undefined,
  provider: AiProviderId,
): AiSettings {
  if (provider === 'off') {
    return {
      ...current,
      provider: 'off',
      enabled: false,
    }
  }

  if (provider === 'custom') {
    return {
      ...current,
      provider: 'custom',
      enabled: true,
      baseUrl: current?.baseUrl ?? '',
      model: current?.model ?? '',
    }
  }

  const preset = AI_PROVIDER_PRESETS[provider]
  return {
    ...current,
    provider,
    enabled: true,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: provider === 'local' ? '' : current?.apiKey,
  }
}

export function resolveAiConnection(ai: AiSettings | undefined): {
  provider: AiProviderId
  apiKey: string
  baseUrl: string
  model: string
} | null {
  const provider = normalizeAiProvider(ai)
  if (provider === 'off') return null

  if (provider === 'local') {
    return {
      provider: 'local',
      apiKey: 'local',
      baseUrl: 'local',
      model: 'local',
    }
  }

  const apiKey = ai?.apiKey?.trim()
  if (!apiKey) return null

  const preset = provider !== 'custom' ? AI_PROVIDER_PRESETS[provider] : null

  return {
    provider,
    apiKey,
    baseUrl: ai?.baseUrl?.trim() || preset?.baseUrl || 'https://api.openai.com/v1',
    model: ai?.model?.trim() || preset?.model || 'gpt-4o-mini',
  }
}

export function providerLabelKey(provider: AiProviderId): string {
  switch (provider) {
    case 'off':
      return 'settings.aiProviderOff'
    case 'local':
      return 'settings.aiProviderLocal'
    case 'openai':
      return 'settings.aiProviderOpenai'
    case 'gemini':
      return 'settings.aiProviderGemini'
    case 'kimi':
      return 'settings.aiProviderKimi'
    case 'custom':
      return 'settings.aiProviderCustom'
  }
}

export function providerStatusKey(provider: AiProviderId): string {
  switch (provider) {
    case 'off':
      return 'ai.providerOff'
    case 'local':
      return 'ai.providerLocal'
    case 'openai':
      return 'ai.providerOpenai'
    case 'gemini':
      return 'ai.providerGemini'
    case 'kimi':
      return 'ai.providerKimi'
    case 'custom':
      return 'ai.providerCustom'
  }
}

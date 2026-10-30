import type { AIProvider } from './ostler-api'
import { t } from './i18n'

/**
 * Built-in model lists, offered in the setup dialog and for an agent run (R5.2), when a cloud provider
 * cannot list its own models (P7.1 lists them with LIST_AI_MODELS first).
 */

export type ModelOption = {
  value: string
  label: string
}

const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'gpt-5.6-sol',
    get label() {
      return t('ai:modelOptions.gpt56Sol')
    }
  },
  {
    value: 'gpt-5.6-terra',
    get label() {
      return t('ai:modelOptions.gpt56Terra')
    }
  },
  {
    value: 'gpt-5.6-luna',
    get label() {
      return t('ai:modelOptions.gpt56Luna')
    }
  },
  {
    value: 'gpt-5.5',
    get label() {
      return t('ai:modelOptions.gpt55Responses')
    }
  },
  {
    value: 'gpt-5.4',
    get label() {
      return t('ai:modelOptions.gpt54Responses')
    }
  },
  {
    value: 'gpt-5.3-codex',
    get label() {
      return t('ai:modelOptions.gpt53Codex')
    }
  },
  {
    value: 'gpt-5.2',
    get label() {
      return t('ai:modelOptions.gpt52Responses')
    }
  },
  {
    value: 'gpt-5',
    get label() {
      return t('ai:modelOptions.gpt5Responses')
    }
  },
  {
    value: 'gpt-4o',
    get label() {
      return t('ai:modelOptions.gptO')
    }
  },
  {
    value: 'gpt-4o-mini',
    get label() {
      return t('ai:modelOptions.gptOMini')
    }
  },
  {
    value: 'gpt-4.1',
    get label() {
      return t('ai:modelOptions.gpt41')
    }
  },
  {
    value: 'gpt-4.1-mini',
    get label() {
      return t('ai:modelOptions.gpt41Mini')
    }
  }
]

const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'claude-sonnet-5-5',
    get label() {
      return t('ai:modelOptions.claudeSonnet55')
    }
  },
  {
    value: 'claude-haiku-5-5',
    get label() {
      return t('ai:modelOptions.claudeHaiku55')
    }
  },
  {
    value: 'claude-opus-5-5',
    get label() {
      return t('ai:modelOptions.claudeOpus55')
    }
  },
  {
    value: 'claude-fable-5-1',
    get label() {
      return t('ai:modelOptions.claudeFable51')
    }
  }
]

const GOOGLE_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'gemini-1.5-pro',
    get label() {
      return t('ai:modelOptions.gemini15Pro')
    }
  },
  {
    value: 'gemini-1.5-flash',
    get label() {
      return t('ai:modelOptions.gemini15Flash')
    }
  },
  {
    value: 'gemini-2.0-flash',
    get label() {
      return t('ai:modelOptions.gemini20Flash')
    }
  },
  {
    value: 'gemini-2.5-pro',
    get label() {
      return t('ai:modelOptions.gemini25Pro')
    }
  },
  {
    value: 'gemini-2.5-flash',
    get label() {
      return t('ai:modelOptions.gemini25Flash')
    }
  }
]

const OPEN_CODE_GO_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'grok-4.5',
    get label() {
      return t('ai:modelOptions.grok45Responses')
    }
  },
  {
    value: 'gpt-5.6-luna',
    get label() {
      return t('ai:modelOptions.gpt56Luna')
    }
  },
  {
    value: 'muse-spark-1.2-contributor',
    get label() {
      return t('ai:modelOptions.museSpark12')
    }
  },
  {
    value: 'glm-5.3',
    get label() {
      return t('ai:modelOptions.glm53')
    }
  },
  {
    value: 'glm-5.2',
    get label() {
      return t('ai:modelOptions.glm52')
    }
  },
  {
    value: 'glm-5.1',
    get label() {
      return t('ai:modelOptions.glm51')
    }
  },
  {
    value: 'kimi-k3',
    get label() {
      return t('ai:modelOptions.kimiK3')
    }
  },
  {
    value: 'kimi-k2.7-code',
    get label() {
      return t('ai:modelOptions.kimiK27Code')
    }
  },
  {
    value: 'kimi-k2.6',
    get label() {
      return t('ai:modelOptions.kimiK26')
    }
  },
  {
    value: 'kimi-k2.5',
    get label() {
      return t('ai:modelOptions.kimiK25')
    }
  },
  {
    value: 'deepseek-v4-pro',
    get label() {
      return t('ai:modelOptions.deepseekV4Pro')
    }
  },
  {
    value: 'deepseek-v4-flash',
    get label() {
      return t('ai:modelOptions.deepseekV4Flash')
    }
  },
  {
    value: 'mimo-v2.5',
    get label() {
      return t('ai:modelOptions.mimoV25')
    }
  },
  {
    value: 'mimo-v2.5-pro',
    get label() {
      return t('ai:modelOptions.mimoV25Pro')
    }
  },
  {
    value: 'mimo-v2-pro',
    get label() {
      return t('ai:modelOptions.mimoV2Pro')
    }
  },
  {
    value: 'mimo-v2-omni',
    get label() {
      return t('ai:modelOptions.mimoV2Omni')
    }
  },
  {
    value: 'glm-5',
    get label() {
      return t('ai:modelOptions.glm5')
    }
  },
  {
    value: 'hy3-preview',
    get label() {
      return t('ai:modelOptions.hy3Preview')
    }
  },
  {
    value: 'hy3',
    get label() {
      return t('ai:modelOptions.hy3')
    }
  },
  {
    value: 'minimax-m3',
    get label() {
      return t('ai:modelOptions.minimaxM3Messages')
    }
  },
  {
    value: 'minimax-m2.7',
    get label() {
      return t('ai:modelOptions.minimaxM27Messages')
    }
  },
  {
    value: 'minimax-m2.5',
    get label() {
      return t('ai:modelOptions.minimaxM25Messages')
    }
  },
  {
    value: 'qwen3.8-max',
    get label() {
      return t('ai:modelOptions.qwen38Max')
    }
  },
  {
    value: 'qwen3.7-max',
    get label() {
      return t('ai:modelOptions.qwen37Max')
    }
  },
  {
    value: 'qwen3.7-plus',
    get label() {
      return t('ai:modelOptions.qwen37Plus')
    }
  },
  {
    value: 'qwen3.6-plus',
    get label() {
      return t('ai:modelOptions.qwen36Plus')
    }
  },
  {
    value: 'qwen3.5-plus',
    get label() {
      return t('ai:modelOptions.qwen35Plus')
    }
  }
]

const OPEN_CODE_ZEN_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'gpt-5.6-sol',
    get label() {
      return t('ai:modelOptions.gpt56Sol')
    }
  },
  {
    value: 'gpt-5.6-terra',
    get label() {
      return t('ai:modelOptions.gpt56Terra')
    }
  },
  {
    value: 'gpt-5.6-luna',
    get label() {
      return t('ai:modelOptions.gpt56Luna')
    }
  },
  {
    value: 'gpt-5.5',
    get label() {
      return t('ai:modelOptions.gpt55Responses')
    }
  },
  {
    value: 'gpt-5.4',
    get label() {
      return t('ai:modelOptions.gpt54Responses')
    }
  },
  {
    value: 'gpt-5.3-codex',
    get label() {
      return t('ai:modelOptions.gpt53Codex')
    }
  },
  {
    value: 'gpt-5.2',
    get label() {
      return t('ai:modelOptions.gpt52Responses')
    }
  },
  {
    value: 'gpt-5',
    get label() {
      return t('ai:modelOptions.gpt5Responses')
    }
  },
  {
    value: 'grok-4.6',
    get label() {
      return t('ai:modelOptions.grok46Responses')
    }
  },
  {
    value: 'grok-4.5',
    get label() {
      return t('ai:modelOptions.grok45Responses')
    }
  },
  {
    value: 'muse-spark-1.2',
    get label() {
      return t('ai:modelOptions.museSpark122')
    }
  },
  {
    value: 'deepseek-v4-pro',
    get label() {
      return t('ai:modelOptions.deepseekV4Pro')
    }
  },
  {
    value: 'deepseek-v4-flash',
    get label() {
      return t('ai:modelOptions.deepseekV4Flash')
    }
  },
  {
    value: 'glm-5.2',
    get label() {
      return t('ai:modelOptions.glm52')
    }
  },
  {
    value: 'glm-5.1',
    get label() {
      return t('ai:modelOptions.glm51')
    }
  },
  {
    value: 'kimi-k3',
    get label() {
      return t('ai:modelOptions.kimiK3')
    }
  },
  {
    value: 'kimi-k2.7-code',
    get label() {
      return t('ai:modelOptions.kimiK27Code')
    }
  },
  {
    value: 'claude-opus-5',
    get label() {
      return t('ai:modelOptions.claudeOpus5Messages')
    }
  },
  {
    value: 'claude-opus-4-6',
    get label() {
      return t('ai:modelOptions.claudeOpus46')
    }
  },
  {
    value: 'claude-sonnet-5',
    get label() {
      return t('ai:modelOptions.claudeSonnet5Messages')
    }
  },
  {
    value: 'claude-sonnet-4-6',
    get label() {
      return t('ai:modelOptions.claudeSonnet46')
    }
  },
  {
    value: 'claude-haiku-4-5',
    get label() {
      return t('ai:modelOptions.claudeHaiku45')
    }
  },
  {
    value: 'qwen3.7-max',
    get label() {
      return t('ai:modelOptions.qwen37Max')
    }
  },
  {
    value: 'qwen3.7-plus',
    get label() {
      return t('ai:modelOptions.qwen37Plus')
    }
  },
  {
    value: 'qwen3.6-plus',
    get label() {
      return t('ai:modelOptions.qwen36Plus')
    }
  },
  {
    value: 'qwen3.5-plus',
    get label() {
      return t('ai:modelOptions.qwen35Plus')
    }
  }
]

const CUSTOM_MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'gpt-4o',
    get label() {
      return t('ai:modelOptions.gptO')
    }
  },
  {
    value: 'gpt-4o-mini',
    get label() {
      return t('ai:modelOptions.gptOMini')
    }
  },
  {
    value: 'gpt-4.1',
    get label() {
      return t('ai:modelOptions.gpt41')
    }
  }
]

export function getModelOptions(provider: AIProvider, baseUrl: string): ModelOption[] {
  if (provider === 'openai') return OPENAI_MODEL_OPTIONS
  if (provider === 'anthropic') return ANTHROPIC_MODEL_OPTIONS
  if (provider === 'google') return GOOGLE_MODEL_OPTIONS

  const normalizedBaseUrl = normalizeModelBaseUrl(baseUrl)
  if (normalizedBaseUrl === 'https://opencode.ai/zen/go/v1') return OPEN_CODE_GO_MODEL_OPTIONS
  if (normalizedBaseUrl === 'https://opencode.ai/zen/v1') return OPEN_CODE_ZEN_MODEL_OPTIONS
  return CUSTOM_MODEL_OPTIONS
}

function normalizeModelBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses|messages)$/i, '')
    .toLowerCase()
}

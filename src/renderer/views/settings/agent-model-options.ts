import { t } from '@shared/i18n' /**
 * The providers a built-in agent can use instead of Ostler AI's, and a
 * sensible model for each: one list for Settings › Agents, the guided agent
 * setup and a project's own override.
 */
export const AGENT_PROVIDER_OPTIONS = [
  {
    value: 'openai',
    get label() {
      return t('agents:agentModelOptions.openai')
    }
  },
  {
    value: 'anthropic',
    get label() {
      return t('agents:agentModelOptions.anthropic')
    }
  },
  {
    value: 'google',
    get label() {
      return t('agents:agentModelOptions.googleGemini')
    }
  },
  {
    value: 'custom',
    get label() {
      return t('agents:agentModelOptions.customProvider')
    }
  }
]

export const AGENT_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5-5',
  google: 'gemini-2.0-flash'
}

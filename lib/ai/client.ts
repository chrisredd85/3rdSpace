import 'server-only'

import OpenAI from 'openai'

const missingApiKeyPlaceholder = 'missing-openai-api-key'

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? missingApiKeyPlaceholder,
})

export function assertOpenAIConfigured() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
}

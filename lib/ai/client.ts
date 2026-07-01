import 'server-only'

import OpenAI from 'openai'

let openAIClient: OpenAI | null = null

function getMissingOpenAIKeyMessage() {
  return 'OPENAI_API_KEY is not configured. Set it in .env.local for local development or Vercel environment variables for deployed runtime.'
}

export function getOpenAI(): OpenAI {
  if (openAIClient) return openAIClient

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(getMissingOpenAIKeyMessage())
  }

  openAIClient = new OpenAI({ apiKey })
  return openAIClient
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, property, receiver) {
    return Reflect.get(getOpenAI(), property, receiver)
  },
})

export function assertOpenAIConfigured() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(getMissingOpenAIKeyMessage())
  }
}

export const CHI_NEW_ENGINE_FLAG = 'CHI_NEW_ENGINE_ENABLED'

export function isCHINewEngineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CHI_NEW_ENGINE_FLAG]?.toLowerCase() === 'true'
}

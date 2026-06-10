import { isCHINewEngineEnabled } from '../featureFlag'

describe('isCHINewEngineEnabled', () => {
  it('defaults off', () => {
    expect(isCHINewEngineEnabled({})).toBe(false)
  })

  it('enables only on true', () => {
    expect(isCHINewEngineEnabled({ CHI_NEW_ENGINE_ENABLED: 'true' })).toBe(true)
    expect(isCHINewEngineEnabled({ CHI_NEW_ENGINE_ENABLED: 'TRUE' })).toBe(true)
    expect(isCHINewEngineEnabled({ CHI_NEW_ENGINE_ENABLED: 'false' })).toBe(false)
    expect(isCHINewEngineEnabled({ CHI_NEW_ENGINE_ENABLED: '1' })).toBe(false)
  })
})

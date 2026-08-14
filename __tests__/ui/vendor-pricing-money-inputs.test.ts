import { readFileSync } from 'fs'
import path from 'path'

describe('vendor pricing money inputs', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'app/(dashboard)/vendor/pricing/page.tsx'),
    'utf8'
  )

  it('accepts cent precision for the per-head incentive dollar input', () => {
    const registrationIndex = source.indexOf("register('per_person_rate'")
    const inputStart = source.lastIndexOf('<Input', registrationIndex)
    const inputEnd = source.indexOf('/>', registrationIndex)
    const inputBlock = source.slice(inputStart, inputEnd + 2)

    expect(registrationIndex).toBeGreaterThan(-1)
    expect(inputBlock).toContain('type="number"')
    expect(inputBlock).toContain('min="0"')
    expect(inputBlock).toContain('step="0.01"')
  })
})

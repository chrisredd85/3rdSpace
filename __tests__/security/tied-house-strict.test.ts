import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const scriptPath = path.join(repoRoot, 'scripts/security/check-tied-house-strict.sh')

function runStrictScan(target: string) {
  const outputPath = path.join(target, 'violations.txt')
  return spawnSync('bash', [scriptPath, target], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TIED_HOUSE_STRICT_OUTPUT: outputPath,
    },
    encoding: 'utf8',
  })
}

describe('strict tied-house compliance script', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), '3rdplace-tied-house-strict-'))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('fails when a production file contains forbidden nomenclature', () => {
    const filePath = path.join(tempRoot, 'route.ts')
    writeFileSync(filePath, "export const label = 'kickback amount'\n")

    const result = runStrictScan(tempRoot)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Strict tied-house compliance check failed')
    expect(result.stderr).toContain('kickback amount')
  })

  it('passes when scanned files contain no forbidden nomenclature', () => {
    const filePath = path.join(tempRoot, 'route.ts')
    writeFileSync(filePath, "export const label = 'Community Host Incentive amount'\n")

    const result = runStrictScan(tempRoot)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Strict tied-house compliance check passed')
  })

  it('excludes test files from strict violations', () => {
    const testDir = path.join(tempRoot, '__tests__')
    mkdirSync(testDir, { recursive: true })
    writeFileSync(path.join(testDir, 'legacy.test.ts'), "expect('kickback').toBeTruthy()\n")

    const result = runStrictScan(tempRoot)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Strict tied-house compliance check passed')
  })
})

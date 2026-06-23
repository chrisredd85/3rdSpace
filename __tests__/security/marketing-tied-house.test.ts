import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const marketingRoot = path.join(repoRoot, 'app/(marketing)')
const marketingComponentsRoot = path.join(repoRoot, 'components/marketing')
const forbiddenPattern =
  /\b(kickback|kick_back|kick-back|rev_share|revShare|RevShare|revenue_share|revenueShare|revenue[\s-]+share|bar_split|barSplit|bar_kickback|headcount_kickback|per_head_kickback)\b/i

function listFiles(root: string): string[] {
  const entries = readdirSync(root)
  return entries.flatMap((entry) => {
    const filePath = path.join(root, entry)
    const stat = statSync(filePath)
    if (stat.isDirectory()) return listFiles(filePath)
    if (/\.(ts|tsx)$/.test(filePath)) return [filePath]
    return []
  })
}

describe('marketing tied-house copy', () => {
  it('does not expose forbidden settlement language on public marketing surfaces', () => {
    const files = [
      ...listFiles(marketingRoot),
      ...listFiles(marketingComponentsRoot),
    ]
    const violations = files.flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8')
      return content.split('\n').flatMap((line, index) => {
        if (!forbiddenPattern.test(line)) return []
        return `${path.relative(repoRoot, filePath)}:${index + 1}: ${line.trim()}`
      })
    })

    expect(violations).toEqual([])
  })
})

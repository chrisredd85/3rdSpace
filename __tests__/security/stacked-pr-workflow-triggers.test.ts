import { readFileSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')

function readWorkflow(name: string) {
  return readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8')
}

function eventBlock(workflow: string, event: string) {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line === `  ${event}:`)

  if (start === -1) {
    throw new Error(`Missing ${event} workflow event`)
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^  [a-z_]+:/.test(line),
  )

  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

describe('required checks on stacked pull requests', () => {
  it('runs both jobs for a stacked PR whose base is neither main nor develop', () => {
    const workflow = readWorkflow('test.yml')
    const pullRequestDeclarations = workflow
      .split('\n')
      .filter((line) => line.startsWith('  pull_request:'))

    expect(pullRequestDeclarations).toEqual(['  pull_request: {}'])
    for (const job of ['test', 'e2e']) {
      const block = eventBlock(workflow, job)

      expect(block).toContain(`  ${job}:`)
      expect(block).not.toMatch(/^    if:/m)
    }
  })

  it.each(['push', 'pull_request'])(
    'reruns RLS checks when test.yml changes on %s',
    (event) => {
      const block = eventBlock(readWorkflow('rls-checks.yml'), event)

      expect(block).toContain("      - '.github/workflows/test.yml'")
    },
  )
})

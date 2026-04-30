import { expect, type Page, type TestInfo } from '@playwright/test'

type PageIssue = {
  type: 'console' | 'pageerror' | 'response'
  message: string
}

const ignoredConsoleSubstrings = [
  'Download the React DevTools',
  'Fast Refresh',
]

export function collectPageHealth(page: Page) {
  const issues: PageIssue[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (ignoredConsoleSubstrings.some((ignored) => text.includes(ignored))) return
    issues.push({ type: 'console', message: text })
  })

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', message: error.message })
  })

  page.on('response', (response) => {
    const status = response.status()
    const url = response.url()
    if (status >= 500 && !url.includes('/_next/webpack-hmr')) {
      issues.push({ type: 'response', message: `${status} ${url}` })
    }
  })

  return issues
}

export async function attachPageHealth(testInfo: TestInfo, issues: PageIssue[]) {
  if (issues.length === 0) return

  await testInfo.attach('page-health-issues.json', {
    body: JSON.stringify(issues, null, 2),
    contentType: 'application/json',
  })
}

export function expectNoPageHealthIssues(issues: PageIssue[]) {
  expect(issues, issues.map((issue) => `${issue.type}: ${issue.message}`).join('\n')).toEqual([])
}

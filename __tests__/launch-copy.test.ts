import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

const launchFacingFiles = [
  'app/(marketing)/page.tsx',
  'app/(marketing)/pricing/page.tsx',
  'app/(marketing)/terms/page.tsx',
  'app/(marketing)/privacy/page.tsx',
  'app/layout.tsx',
  'app/robots.ts',
  'app/sitemap.ts',
  'components/auth/VenueListingInfoPage.tsx',
  'components/auth/VendorListingInfoPage.tsx',
  'components/shared/ErrorState.tsx',
  'lib/billing/builder-billing.ts',
  'lib/email.ts',
  'lib/invoices/vendor-invoices.ts',
  'lib/planner/mockAgentResponses.ts',
  'lib/server/opportunity-email-worker.ts',
  'public/mockups/planner-product-path-mockup.html',
  'public/ux-mockup.html',
]

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('launch-facing copy', () => {
  it('uses 3rdPlace in brand-visible surfaces', () => {
    const offenders = launchFacingFiles.flatMap((file) => {
      const content = read(file)
      return /3rdSpace|3rdspace\.com|3rdPlaces/.test(content) ? [file] : []
    })

    expect(offenders).toEqual([])
  })

  it('keeps launch metadata out of marketplace framing', () => {
    const content = [
      read('app/layout.tsx'),
      read('app/(marketing)/page.tsx'),
      read('app/(marketing)/pricing/page.tsx'),
    ].join('\n')

    expect(content).not.toMatch(/event marketplace|priority concierge/i)
    expect(content).toMatch(/approval-gated event operating workspace/i)
  })

  it('does not ship placeholder legal pages', () => {
    for (const file of ['app/(marketing)/terms/page.tsx', 'app/(marketing)/privacy/page.tsx']) {
      const content = read(file)
      expect(content).toContain('LAST_UPDATED')
      expect(content).not.toMatch(/lorem|TODO|TBD|placeholder legal|replace this/i)
    }
  })
})

describe('deprecated visual compatibility aliases', () => {
  it('keeps old variant names but maps them to editorial surfaces', () => {
    const button = read('components/ui/button.tsx')
    const globals = read('app/globals.css')

    expect(button).toContain('hero:')
    expect(button).toContain('glass:')
    expect(button).not.toMatch(/hero:.*bg-gradient-brand/)
    expect(button).not.toMatch(/hero:.*shadow-glow/)
    expect(button).not.toMatch(/glass: "glass/)
    expect(globals).toContain('Compatibility aliases for deprecated visual names')
    expect(globals).not.toContain('backdrop-filter: blur')
    expect(globals).not.toMatch(/^\s*color:\s*transparent;/m)
  })
})

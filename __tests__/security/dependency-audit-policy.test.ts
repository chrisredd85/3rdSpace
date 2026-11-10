/* eslint-disable @typescript-eslint/no-require-imports */

type AuditFinding = {
  name: string
  severity: string
  isDirect: boolean
  via: unknown[]
  effects: string[]
  range: string
  nodes: string[]
  fixAvailable: boolean
}

const auditPolicy = require('../../scripts/security/check-dependency-audit.cjs') as {
  validateAuditReport: (report: unknown) => unknown
  ZOD_DOS_EXCEPTION: { package: string; advisoryId: string; url: string; severity: string; range: string }
}
const { validateAuditReport } = auditPolicy
const ZOD_ADVISORY = 'GHSA-mrhx-c7xc-m3w5'

function cleanReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      harmless: {
        name: 'harmless',
        severity: 'moderate',
        isDirect: false,
        via: [],
        effects: [],
        range: '*',
        nodes: ['node_modules/harmless'],
        fixAvailable: false,
      },
    } as Record<string, AuditFinding>,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 },
    },
  }
}

function zodReport() {
  const report = cleanReport()
  report.vulnerabilities.zod = {
    name: 'zod',
    severity: 'high',
    isDirect: true,
    via: [{
      name: 'zod',
      dependency: 'zod',
      url: `https://github.com/advisories/${ZOD_ADVISORY}`,
      severity: 'high',
      range: '<4.6.6',
    }],
    effects: [],
    range: '<4.6.6',
    nodes: ['node_modules/zod'],
    fixAvailable: false,
  }
  report.metadata.vulnerabilities.high = 1
  report.metadata.vulnerabilities.total = 2
  return report
}

describe('dependency audit policy', () => {
  it('accepts a production audit with zero high or critical advisories', () => {
    expect(validateAuditReport(cleanReport())).toEqual({
      high: 0,
      critical: 0,
      exceptions: [],
    })
  })

  it('accepts only the reviewed Zod advisory and reports its raw high count', () => {
    expect(validateAuditReport(zodReport())).toEqual({
      high: 1,
      critical: 0,
      exceptions: [ZOD_ADVISORY],
    })
  })

  it('fails closed for an unrelated high advisory alongside the approved Zod finding', () => {
    const report = zodReport()
    report.vulnerabilities.sharp = {
      name: 'sharp',
      severity: 'high',
      isDirect: false,
      via: [],
      effects: [],
      range: '*',
      nodes: ['node_modules/sharp'],
      fixAvailable: false,
    }
    report.metadata.vulnerabilities.high = 2
    report.metadata.vulnerabilities.total = 3

    expect(() => validateAuditReport(report)).toThrow(
      'Unapproved high/critical production advisories: sharp'
    )
  })

  it('fails closed for any critical advisory', () => {
    const report = cleanReport()
    report.vulnerabilities.next = {
      name: 'next',
      severity: 'critical',
      isDirect: true,
      via: [],
      effects: [],
      range: '*',
      nodes: ['node_modules/next'],
      fixAvailable: false,
    }
    report.metadata.vulnerabilities.critical = 1
    report.metadata.vulnerabilities.total = 2

    expect(() => validateAuditReport(report)).toThrow(
      'Unapproved high/critical production advisories: next'
    )
  })

  it('does not allow another package to reuse the approved advisory URL', () => {
    const report = zodReport()
    report.vulnerabilities.other = { ...report.vulnerabilities.zod, name: 'other' }
    delete report.vulnerabilities.zod
    expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: other')
  })

  it('does not exempt a second high advisory on Zod', () => {
    const report = zodReport()
    report.vulnerabilities.zod.via.push({
      name: 'zod', dependency: 'zod', severity: 'high', range: '<4.6.6',
      url: 'https://github.com/advisories/GHSA-new-advisory',
    })
    expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: zod')
  })

  it.each([
    { url: `https://example.com/advisories/${ZOD_ADVISORY}` },
    { severity: 'critical' },
    { range: '<5.0.0' },
    { dependency: 'another-package' },
    { name: 'another-package' },
  ])('rejects changed advisory identity, severity or affected scope: %o', (change) => {
    const report = zodReport()
    report.vulnerabilities.zod.via[0] = {
      ...(report.vulnerabilities.zod.via[0] as Record<string, unknown>), ...change,
    }
    expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: zod')
  })

  it.each([[], ['zod'], ['missing-parent'], [null], [42], [{}]].map((via) => [via]))(
    'rejects unresolved or malformed high-advisory via chains: %j', (via) => {
      const report = zodReport()
      report.vulnerabilities.zod.via = via
      expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: zod')
    }
  )

  it('does not inherit the exception through a high-severity parent package', () => {
    const report = zodReport()
    report.vulnerabilities.parent = {
      ...report.vulnerabilities.zod, name: 'parent', via: ['zod'],
    }
    report.metadata.vulnerabilities.high = 2
    expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: parent')
  })

  it('rejects an aggregate severity escalation even with the old advisory object', () => {
    const report = zodReport()
    report.vulnerabilities.zod.severity = 'critical'
    report.metadata.vulnerabilities.high = 0
    report.metadata.vulnerabilities.critical = 1
    expect(() => validateAuditReport(report)).toThrow('Unapproved high/critical production advisories: zod')
  })

  it('rejects inconsistent metadata and missing finding details', () => {
    const report = zodReport()
    report.metadata.vulnerabilities.high = 2
    expect(() => validateAuditReport(report)).toThrow('Production high advisory count does not match findings')
    expect(() => validateAuditReport({
      ...cleanReport(), metadata: { vulnerabilities: { high: 1, critical: 0 } },
    })).toThrow('Production high advisory count does not match findings')
    expect(() => validateAuditReport({
      ...cleanReport(), metadata: { vulnerabilities: { high: 0, critical: 1 } },
    })).toThrow('Production critical advisory count must be zero')
    const malformed = zodReport()
    malformed.vulnerabilities.zod.via = null as unknown as unknown[]
    expect(() => validateAuditReport(malformed)).toThrow('Malformed production advisory: zod')
  })

  it('rejects an advisory hidden behind a lower package severity', () => {
    const report = zodReport()
    report.vulnerabilities.zod.severity = 'moderate'
    report.metadata.vulnerabilities.high = 0
    expect(() => validateAuditReport(report)).toThrow('Inconsistent production advisory severity: zod')
  })

  it('rejects malformed and npm-error reports', () => {
    expect(() => validateAuditReport(null)).toThrow('malformed JSON')
    expect(() => validateAuditReport({
      ...cleanReport(), vulnerabilities: [],
    })).toThrow('missing vulnerabilities')
    expect(() => validateAuditReport({
      ...cleanReport(), metadata: {},
    })).toThrow('missing vulnerability counts')
    expect(() =>
      validateAuditReport({ error: { code: 'EAUDIT', summary: 'audit failed' } })
    ).toThrow('npm audit failed: audit failed')
  })

  it('keeps exactly the approved exception and the specified patched dependency graph', () => {
    const packageJson = require('../../package.json') as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      scripts: Record<string, string>
      overrides: Record<string, unknown>
    }
    const packageLock = require('../../package-lock.json') as {
      packages: Record<string, { version?: string }>
    }
    const policySource = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'scripts/security/check-dependency-audit.cjs'),
      'utf8'
    )

    expect(auditPolicy).not.toHaveProperty('SHARP_EXCEPTION')
    expect(auditPolicy.ZOD_DOS_EXCEPTION).toEqual({
      package: 'zod', advisoryId: ZOD_ADVISORY,
      url: `https://github.com/advisories/${ZOD_ADVISORY}`,
      severity: 'high', range: '<4.6.6',
    })
    expect(policySource).not.toMatch(/SHARP_EXCEPTION|GHSA-f88m/)
    expect(policySource).toContain('TD-SEC-ZOD4')
    expect(packageJson.scripts['security:deps']).toContain(
      'node scripts/security/check-dependency-audit.cjs'
    )
    expect(packageJson.scripts['security:deps']).not.toContain('audit fix')
    expect(packageJson.scripts['security:deps']).not.toContain('--force')
    expect(packageJson.dependencies.next).toBe('15.5.28')
    expect(packageJson.dependencies['@sentry/nextjs']).toBe('10.75.2')
    expect(packageJson.dependencies.zod).toBe('^3.22.4')
    expect(packageJson.devDependencies['@next/bundle-analyzer']).toBe('^15.5.25')
    expect(packageJson.devDependencies['eslint-config-next']).toBe('^15.5.25')
    expect(packageJson.overrides).toEqual({
      browserslist: '4.28.9',
      'fast-uri': '3.1.7',
      next: { postcss: '8.5.26' },
      sharp: '0.35.5',
      'source-map-js': '1.2.2',
      'brace-expansion@1': '1.1.21',
      'brace-expansion@2': '2.1.7',
      'brace-expansion@5': '5.0.12',
    })
    expect(packageLock.packages['node_modules/browserslist']?.version).toBe('4.28.9')
    expect(packageLock.packages['node_modules/fast-uri']?.version).toBe('3.1.7')
    expect(packageLock.packages['node_modules/next']?.version).toBe('15.5.28')
    expect(packageLock.packages['node_modules/sharp']?.version).toBe('0.35.5')
    expect(packageLock.packages['node_modules/source-map-js']?.version).toBe('1.2.2')
    expect(packageLock.packages['node_modules/zod']?.version).toBe('3.25.76')
    expect(packageLock.packages['node_modules/@playwright/test']?.version).toBe('1.57.0')
  })
})

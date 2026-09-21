/* eslint-disable @typescript-eslint/no-require-imports */

const auditPolicy = require('../../scripts/security/check-dependency-audit.cjs') as {
  validateAuditReport: (report: unknown) => unknown
}
const { validateAuditReport } = auditPolicy

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
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 },
    },
  }
}

describe('dependency audit policy', () => {
  it('accepts a production audit with zero high or critical advisories', () => {
    expect(validateAuditReport(cleanReport())).toEqual({
      high: 0,
      critical: 0,
    })
  })

  it('fails closed for any high advisory', () => {
    const report = cleanReport()
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
    report.metadata.vulnerabilities.high = 1
    report.metadata.vulnerabilities.total = 2

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

  it('rejects malformed and npm-error reports', () => {
    expect(() => validateAuditReport(null)).toThrow('malformed JSON')
    expect(() =>
      validateAuditReport({ error: { code: 'EAUDIT', summary: 'audit failed' } })
    ).toThrow('npm audit failed: audit failed')
  })

  it('keeps a zero-exception production gate and pins the remediated dependency graph', () => {
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
    expect(policySource).not.toMatch(/SHARP_EXCEPTION|GHSA-f88m|expiresAt|Allowed advisory/)
    expect(packageJson.scripts['security:deps']).toContain(
      'node scripts/security/check-dependency-audit.cjs'
    )
    expect(packageJson.scripts['security:deps']).not.toContain('audit fix')
    expect(packageJson.scripts['security:deps']).not.toContain('--force')
    expect(packageJson.dependencies.next).toBe('^15.5.25')
    expect(packageJson.devDependencies['@next/bundle-analyzer']).toBe('^15.5.25')
    expect(packageJson.devDependencies['eslint-config-next']).toBe('^15.5.25')
    expect(packageJson.overrides).toEqual({
      browserslist: '4.28.9',
      'fast-uri': '3.1.7',
      next: { postcss: '8.5.26' },
      sharp: '0.35.4',
    })
    expect(packageLock.packages['node_modules/browserslist']?.version).toBe('4.28.9')
    expect(packageLock.packages['node_modules/fast-uri']?.version).toBe('3.1.7')
    expect(packageLock.packages['node_modules/next']?.version).toBe('15.5.25')
    expect(packageLock.packages['node_modules/sharp']?.version).toBe('0.35.4')
  })
})

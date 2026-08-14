/* eslint-disable @typescript-eslint/no-require-imports */

const {
  SHARP_EXCEPTION,
  validateAuditReport,
} = require('../../scripts/security/check-dependency-audit.cjs') as {
  SHARP_EXCEPTION: { expiresAt: string }
  validateAuditReport: (report: unknown, now?: Date) => unknown
}

function scopedReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      next: {
        name: 'next',
        severity: 'high',
        isDirect: true,
        via: ['sharp'],
        effects: [],
        range: '9.5.6-canary.0 - 10.0.7 || 14.3.0-canary.0 - 16.3.0-preview.10',
        nodes: ['node_modules/next'],
        fixAvailable: { name: 'next', version: '16.3.1', isSemVerMajor: true },
      },
      sharp: {
        name: 'sharp',
        severity: 'high',
        isDirect: false,
        via: [
          {
            source: 1124066,
            name: 'sharp',
            dependency: 'sharp',
            title: 'sharp inherited vulnerabilities in libvips',
            url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
            severity: 'high',
            range: '<0.35.0',
          },
        ],
        effects: ['next'],
        range: '<0.35.0',
        nodes: ['node_modules/sharp'],
        fixAvailable: { name: 'next', version: '16.3.1', isSemVerMajor: true },
      },
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
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 2, critical: 0, total: 3 },
    },
  }
}

const beforeExpiry = new Date('2026-08-12T12:00:00.000Z')

describe('dependency audit policy', () => {
  it('accepts only the exact security-relevant GHSA-f88m Sharp-to-Next chain before expiry', () => {
    expect(validateAuditReport(scopedReport(), beforeExpiry)).toEqual({
      allowedAdvisory: 'GHSA-f88m-g3jw-g9cj',
      allowedPackages: ['next', 'sharp'],
      expiresAt: SHARP_EXCEPTION.expiresAt,
      high: 2,
      critical: 0,
    })
  })

  it('accepts npm remediation-version drift while preserving security invariants', () => {
    const report = scopedReport()
    report.vulnerabilities.next.fixAvailable.version = '16.3.2'
    report.vulnerabilities.sharp.fixAvailable.version = '16.3.2'

    expect(validateAuditReport(report, beforeExpiry)).toEqual({
      allowedAdvisory: 'GHSA-f88m-g3jw-g9cj',
      allowedPackages: ['next', 'sharp'],
      expiresAt: SHARP_EXCEPTION.expiresAt,
      high: 2,
      critical: 0,
    })
  })

  it('fails closed when npm reports a narrow non-major remediation', () => {
    const report = scopedReport()
    report.vulnerabilities.next.fixAvailable.version = '15.5.24'
    report.vulnerabilities.next.fixAvailable.isSemVerMajor = false
    report.vulnerabilities.sharp.fixAvailable.version = '15.5.24'
    report.vulnerabilities.sharp.fixAvailable.isSemVerMajor = false

    expect(() => validateAuditReport(report, beforeExpiry)).toThrow(
      'Sharp remediation is no longer a breaking Next upgrade'
    )
  })

  it('fails closed when the exception expires', () => {
    expect(() =>
      validateAuditReport(scopedReport(), new Date(SHARP_EXCEPTION.expiresAt))
    ).toThrow('Sharp exception expired')
  })

  it('fails closed for any additional high advisory', () => {
    const report = scopedReport()
    report.vulnerabilities.other = {
      name: 'other',
      severity: 'high',
      isDirect: true,
      via: [],
      effects: [],
      range: '*',
      nodes: ['node_modules/other'],
      fixAvailable: false,
    }
    report.metadata.vulnerabilities.high = 3
    report.metadata.vulnerabilities.total = 4

    expect(() => validateAuditReport(report, beforeExpiry)).toThrow(
      'Unapproved high/critical production advisories'
    )
  })

  it('fails closed for any critical advisory', () => {
    const report = scopedReport()
    report.vulnerabilities.critical = {
      name: 'critical',
      severity: 'critical',
      isDirect: false,
      via: [],
      effects: [],
      range: '*',
      nodes: ['node_modules/critical'],
      fixAvailable: false,
    }
    report.metadata.vulnerabilities.critical = 1
    report.metadata.vulnerabilities.total = 4

    expect(() => validateAuditReport(report, beforeExpiry)).toThrow(
      'Unapproved high/critical production advisories'
    )
  })

  it.each([
    ['source', 999999],
    ['url', 'https://github.com/advisories/GHSA-wrong'],
    ['range', '<0.99.0'],
  ])('rejects changed Sharp advisory %s', (field, value) => {
    const report = scopedReport()
    Object.assign(report.vulnerabilities.sharp.via[0], { [field]: value })
    expect(() => validateAuditReport(report, beforeExpiry)).toThrow()
  })

  it('rejects a changed dependency path or parent chain', () => {
    const report = scopedReport()
    report.vulnerabilities.sharp.nodes = ['node_modules/next/node_modules/sharp']
    expect(() => validateAuditReport(report, beforeExpiry)).toThrow(
      'Scoped Sharp dependency path changed'
    )
  })

  it('rejects a stale exception after the vulnerable chain disappears', () => {
    const report = scopedReport()
    report.vulnerabilities = {
      harmless: report.vulnerabilities.harmless,
    } as typeof report.vulnerabilities
    report.metadata.vulnerabilities.high = 0
    report.metadata.vulnerabilities.total = 1

    expect(() => validateAuditReport(report, beforeExpiry)).toThrow(
      'Sharp exception is stale or unused'
    )
  })

  it('rejects malformed and npm-error reports', () => {
    expect(() => validateAuditReport(null, beforeExpiry)).toThrow('malformed JSON')
    expect(() =>
      validateAuditReport({ error: { code: 'EAUDIT', summary: 'audit failed' } }, beforeExpiry)
    ).toThrow('npm audit failed: audit failed')
  })

  it('keeps the package script pinned to the strict production-audit wrapper', () => {
    const packageJson = require('../../package.json') as {
      scripts: Record<string, string>
      overrides: Record<string, unknown>
    }
    expect(packageJson.scripts['security:deps']).toContain(
      'node scripts/security/check-dependency-audit.cjs'
    )
    expect(packageJson.scripts['security:deps']).not.toContain('audit fix')
    expect(packageJson.scripts['security:deps']).not.toContain('--force')
    expect(packageJson.overrides).toEqual({ next: { postcss: '8.5.26' } })
  })
})

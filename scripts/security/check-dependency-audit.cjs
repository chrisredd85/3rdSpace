#!/usr/bin/env node

const { spawnSync } = require('node:child_process')

// Human-approved on 2026-11-10: interim residual DoS risk ACCEPTED for this
// advisory only (CVSS v4 8.2, Availability-only; no confidentiality, integrity,
// or authorization bypass). EPSS at review: approximately 0.35%, 28th percentile.
// No Zod 3.x fix exists; 4.6.6 is a breaking major requiring application changes.
// Remediation: scheduled Zod 4 migration TD-SEC-ZOD4 (review 2026-11-24), NOT a
// body cap. A stopgap global cap was evaluated and deferred because legitimate
// JSON CSV imports, agent payloads and intake plans have no defined size ceiling;
// guessing one could break them. Serverless instance isolation limits the blast
// radius, but shared-instance requests and repeated invocations remain at risk.
// Remove this exception when TD-SEC-ZOD4 lands; tracked in test-results/STATUS.md
// and docs/MVP_EXECUTION_BRIEF.md. No other advisory is approved.
const ZOD_DOS_EXCEPTION = Object.freeze({
  package: 'zod',
  advisoryId: 'GHSA-mrhx-c7xc-m3w5',
  url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
  severity: 'high',
  range: '<4.6.6',
})

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isApprovedZodFinding(name, finding) {
  return name === ZOD_DOS_EXCEPTION.package &&
    finding.name === ZOD_DOS_EXCEPTION.package &&
    finding.severity === ZOD_DOS_EXCEPTION.severity &&
    finding.range === ZOD_DOS_EXCEPTION.range &&
    finding.via.length > 0 &&
    finding.via.every((advisory) =>
      isObject(advisory) &&
      advisory.name === ZOD_DOS_EXCEPTION.package &&
      advisory.dependency === ZOD_DOS_EXCEPTION.package &&
      advisory.url === ZOD_DOS_EXCEPTION.url &&
      advisory.severity === ZOD_DOS_EXCEPTION.severity &&
      advisory.range === ZOD_DOS_EXCEPTION.range
    )
}

function validateAuditReport(report) {
  invariant(isObject(report), 'npm audit returned malformed JSON')
  invariant(report.error === undefined, `npm audit failed: ${report.error?.summary || report.error?.code || 'unknown error'}`)
  invariant(isObject(report.vulnerabilities), 'npm audit report is missing vulnerabilities')
  invariant(isObject(report.metadata?.vulnerabilities), 'npm audit report is missing vulnerability counts')

  const findings = Object.entries(report.vulnerabilities)
  for (const [name, finding] of findings) {
    invariant(
      isObject(finding) && finding.name === name &&
      ['info', 'low', 'moderate', 'high', 'critical'].includes(finding.severity) &&
      Array.isArray(finding.via),
      `Malformed production advisory: ${name}`
    )
    // A malformed summary must not hide a direct high/critical advisory.
    invariant(
      !finding.via.some((advisory) => isObject(advisory) &&
        (advisory.severity === 'high' || advisory.severity === 'critical') &&
        finding.severity !== 'high' && finding.severity !== 'critical'),
      `Inconsistent production advisory severity: ${name}`
    )
  }

  const highOrCritical = findings
    .filter(([, value]) => value?.severity === 'high' || value?.severity === 'critical')
  const unapproved = highOrCritical
    .filter(([name, finding]) => !isApprovedZodFinding(name, finding))
    .map(([name]) => name)
    .sort()

  invariant(
    unapproved.length === 0,
    `Unapproved high/critical production advisories: ${unapproved.join(', ') || 'none'}`
  )
  invariant(
    report.metadata.vulnerabilities.high === highOrCritical.filter(([, value]) => value.severity === 'high').length,
    'Production high advisory count does not match findings'
  )
  invariant(
    report.metadata.vulnerabilities.critical === 0,
    'Production critical advisory count must be zero'
  )

  return {
    high: report.metadata.vulnerabilities.high,
    critical: report.metadata.vulnerabilities.critical,
    exceptions: highOrCritical.length > 0 ? [ZOD_DOS_EXCEPTION.advisoryId] : [],
  }
}

function runAudit() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(
    npmCommand,
    ['audit', '--json', '--audit-level=high', '--omit=dev'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )

  if (result.error) throw result.error
  invariant(result.status === 0 || result.status === 1, `npm audit exited unexpectedly with status ${result.status}`)

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error('npm audit did not return valid JSON')
  }

  const receipt = validateAuditReport(report)
  console.log('Dependency audit policy: PASS')
  console.log(`Production high advisories: ${receipt.high}`)
  console.log(`Production critical advisories: ${receipt.critical}`)
  console.log(`Dependency audit exceptions: ${receipt.exceptions.join(', ') || 'none'}`)
}

if (require.main === module) {
  try {
    runAudit()
  } catch (error) {
    console.error(`Dependency audit policy: FAIL - ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

module.exports = {
  validateAuditReport,
  ZOD_DOS_EXCEPTION,
}

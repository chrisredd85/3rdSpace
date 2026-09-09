#!/usr/bin/env node

const { spawnSync } = require('node:child_process')

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function validateAuditReport(report) {
  invariant(report && typeof report === 'object' && !Array.isArray(report), 'npm audit returned malformed JSON')
  invariant(report.error === undefined, `npm audit failed: ${report.error?.summary || report.error?.code || 'unknown error'}`)
  invariant(report.vulnerabilities && typeof report.vulnerabilities === 'object', 'npm audit report is missing vulnerabilities')
  invariant(report.metadata?.vulnerabilities, 'npm audit report is missing vulnerability counts')

  const highOrCritical = Object.entries(report.vulnerabilities)
    .filter(([, value]) => value?.severity === 'high' || value?.severity === 'critical')
    .map(([name]) => name)
    .sort()

  invariant(
    highOrCritical.length === 0,
    `Unapproved high/critical production advisories: ${highOrCritical.join(', ') || 'none'}`
  )
  invariant(report.metadata.vulnerabilities.high === 0, 'Production high advisory count must be zero')
  invariant(report.metadata.vulnerabilities.critical === 0, 'Production critical advisory count must be zero')

  return {
    high: report.metadata.vulnerabilities.high,
    critical: report.metadata.vulnerabilities.critical,
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
  console.log('Dependency audit exceptions: none')
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
}

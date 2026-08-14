#!/usr/bin/env node

const { spawnSync } = require('node:child_process')

// Remove this exception no later than the expiry below by completing the
// reviewed Next 16 migration to a release whose Sharp dependency is >=0.35.0.
// npm currently recommends Next.js 16.3.1, but the exact fixAvailable.version
// advances as patched releases publish and is intentionally not a policy invariant.
const SHARP_EXCEPTION = Object.freeze({
  advisorySource: 1124066,
  advisoryUrl: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
  advisoryName: 'sharp',
  dependency: 'sharp',
  severity: 'high',
  vulnerableRange: '<0.35.0',
  nodePath: 'node_modules/sharp',
  parentPackage: 'next',
  expiresAt: '2026-09-12T00:00:00.000Z',
})

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function sortedStrings(value) {
  invariant(Array.isArray(value), 'Dependency audit field must be an array')
  invariant(value.every((entry) => typeof entry === 'string'), 'Dependency audit array must contain strings')
  return [...value].sort()
}

function sameStrings(actual, expected) {
  const left = sortedStrings(actual)
  const right = [...expected].sort()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateSharpAdvisory(sharp) {
  invariant(sharp && typeof sharp === 'object', 'Expected the scoped Sharp advisory')
  invariant(sharp.name === 'sharp', 'Scoped exception package must be sharp')
  invariant(sharp.severity === 'high', 'Scoped Sharp advisory severity changed')
  invariant(sharp.isDirect === false, 'Scoped Sharp advisory must remain transitive')
  invariant(sharp.range === SHARP_EXCEPTION.vulnerableRange, 'Scoped Sharp vulnerable range changed')
  invariant(sameStrings(sharp.nodes, [SHARP_EXCEPTION.nodePath]), 'Scoped Sharp dependency path changed')
  invariant(sameStrings(sharp.effects, [SHARP_EXCEPTION.parentPackage]), 'Scoped Sharp parent chain changed')
  invariant(Array.isArray(sharp.via) && sharp.via.length === 1, 'Sharp contains an unapproved advisory')

  const advisory = sharp.via[0]
  invariant(advisory && typeof advisory === 'object', 'Sharp advisory identity is missing')
  invariant(advisory.source === SHARP_EXCEPTION.advisorySource, 'Sharp advisory source changed')
  invariant(advisory.url === SHARP_EXCEPTION.advisoryUrl, 'Sharp advisory URL changed')
  invariant(advisory.name === SHARP_EXCEPTION.advisoryName, 'Sharp advisory name changed')
  invariant(advisory.dependency === SHARP_EXCEPTION.dependency, 'Sharp advisory dependency changed')
  invariant(advisory.severity === SHARP_EXCEPTION.severity, 'Sharp advisory severity changed')
  invariant(advisory.range === SHARP_EXCEPTION.vulnerableRange, 'Sharp advisory range changed')

  invariant(sharp.fixAvailable && typeof sharp.fixAvailable === 'object', 'Sharp remediation metadata is missing')
  invariant(sharp.fixAvailable.name === 'next', 'Sharp remediation is no longer the expected Next upgrade')
  invariant(sharp.fixAvailable.isSemVerMajor === true, 'Sharp remediation is no longer a breaking Next upgrade')
}

function validateNextAggregator(next) {
  invariant(next && typeof next === 'object', 'Expected the Next aggregator for the scoped Sharp advisory')
  invariant(next.name === 'next', 'Scoped parent package must be next')
  invariant(next.severity === 'high', 'Scoped Next aggregator severity changed')
  invariant(next.isDirect === true, 'Next must remain a direct production dependency')
  invariant(sameStrings(next.via, ['sharp']), 'Next contains an unapproved production advisory')
  invariant(sameStrings(next.effects, []), 'Next advisory chain gained unexpected dependents')
  invariant(sameStrings(next.nodes, ['node_modules/next']), 'Scoped Next dependency path changed')
  invariant(next.fixAvailable && typeof next.fixAvailable === 'object', 'Next remediation metadata is missing')
  invariant(next.fixAvailable.name === 'next', 'Next remediation package changed')
  invariant(next.fixAvailable.isSemVerMajor === true, 'Next remediation is no longer a major upgrade')
}

function validateAuditReport(report, now = new Date()) {
  invariant(report && typeof report === 'object' && !Array.isArray(report), 'npm audit returned malformed JSON')
  invariant(report.error === undefined, `npm audit failed: ${report.error?.summary || report.error?.code || 'unknown error'}`)
  invariant(report.vulnerabilities && typeof report.vulnerabilities === 'object', 'npm audit report is missing vulnerabilities')
  invariant(report.metadata?.vulnerabilities, 'npm audit report is missing vulnerability counts')

  const expiresAt = new Date(SHARP_EXCEPTION.expiresAt)
  invariant(Number.isFinite(now.getTime()), 'Audit policy received an invalid current time')
  invariant(now.getTime() < expiresAt.getTime(), `Sharp exception expired at ${SHARP_EXCEPTION.expiresAt}`)

  const highOrCritical = Object.entries(report.vulnerabilities)
    .filter(([, value]) => value?.severity === 'high' || value?.severity === 'critical')
    .map(([name]) => name)
    .sort()

  invariant(
    highOrCritical.length > 0,
    'Sharp exception is stale or unused because no high/critical production advisory remains'
  )
  invariant(
    sameStrings(highOrCritical, ['next', 'sharp']),
    `Unapproved high/critical production advisories: ${highOrCritical.join(', ') || 'none'}`
  )
  invariant(report.metadata.vulnerabilities.critical === 0, 'Critical production advisories are never excepted')
  invariant(report.metadata.vulnerabilities.high === 2, 'High production advisory count must be exactly the scoped Sharp chain')

  validateSharpAdvisory(report.vulnerabilities.sharp)
  validateNextAggregator(report.vulnerabilities.next)

  return {
    allowedAdvisory: 'GHSA-f88m-g3jw-g9cj',
    allowedPackages: ['next', 'sharp'],
    expiresAt: SHARP_EXCEPTION.expiresAt,
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
  console.log(`Allowed advisory: ${receipt.allowedAdvisory}`)
  console.log(`Allowed production high chain: ${receipt.allowedPackages.join(' -> ')}`)
  console.log(`Exception expires: ${receipt.expiresAt}`)
  console.log(`Unapproved high/critical advisories: 0`)
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
  SHARP_EXCEPTION,
  validateAuditReport,
}

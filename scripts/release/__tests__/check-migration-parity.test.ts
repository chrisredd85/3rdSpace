import {
  compareMigrationParity,
  parseSupabaseMigrationList,
} from '@/scripts/release/check-migration-parity'

describe('hosted migration parity checker', () => {
  const ledger = `
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260627000000 | 20260627000000 | 2026-06-27 00:00:00
   20260701090000 |                | 2026-07-01 09:00:00
                  | 20260702000000 | 2026-07-02 00:00:00
  `

  it('parses missing-local and missing-remote rows from Supabase output', () => {
    expect(parseSupabaseMigrationList(ledger)).toEqual({
      localVersions: ['20260627000000', '20260701090000'],
      remoteVersions: ['20260627000000', '20260702000000'],
    })
  })

  it('fails closed when a table-shaped row contains an invalid version', () => {
    expect(() => parseSupabaseMigrationList(`
      Local          | Remote         | Time (UTC)
      ----------------|----------------|---------------------
      20260701090000 | 20260701090000 | 2026-07-01 09:00:00
                     | legacy_remote  | unknown
    `)).toThrow('Invalid remote migration version in ledger: legacy_remote')
  })

  it('fails closed on a malformed ledger row after a valid row', () => {
    expect(() => parseSupabaseMigrationList(`
      20260701090000 | 20260701090000 | 2026-07-01 09:00:00
      20260702000000 | 20260702000000
    `)).toThrow('Malformed migration ledger row')
  })

  it('fails on any unapproved code/schema drift', () => {
    const parity = compareMigrationParity(
      ['20260627000000', '20260701090000'],
      ['20260627000000']
    )
    expect(parity.ok).toBe(false)
    expect(parity.disallowedMissing).toEqual(['20260701090000'])
  })

  it('allows an exact expected-missing set for operator preflight only', () => {
    const parity = compareMigrationParity(
      ['20260627000000', '20260701090000'],
      ['20260627000000'],
      ['20260701090000']
    )
    expect(parity.ok).toBe(true)
    expect(parity.missingRemote).toEqual(['20260701090000'])
  })

  it('fails when an expected-missing exception becomes stale', () => {
    const parity = compareMigrationParity(
      ['20260627000000', '20260701090000'],
      ['20260627000000', '20260701090000'],
      ['20260701090000']
    )
    expect(parity.ok).toBe(false)
    expect(parity.staleAllowedMissing).toEqual(['20260701090000'])
  })
})

export function hasImportedGuestAttendanceLabel(confirmedLabel: string): boolean {
  const normalized = confirmedLabel.trim().toLowerCase()

  if (!normalized) return false

  return !(
    normalized.startsWith('no confirmed') ||
    normalized.startsWith('no imported') ||
    normalized.startsWith('no attendance')
  )
}

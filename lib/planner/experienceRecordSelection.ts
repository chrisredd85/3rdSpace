export type ExperienceRecordSelectionItem = {
  id: string
  kind: 'event' | 'plan'
  createdAt?: string | null
  updatedAt?: string | null
}

export function selectExperienceRecord<T extends ExperienceRecordSelectionItem>(
  records: T[],
  recordKey?: string | null
): T | null {
  if (recordKey) {
    const selected = records.find((record) => toRecordKey(record) === recordKey)
    if (selected) return selected
  }

  const newestPlan = records
    .filter((record) => record.kind === 'plan')
    .sort((first, second) => getFreshnessValue(second) - getFreshnessValue(first))[0]

  return newestPlan ?? records[0] ?? null
}

export function orderExperienceRecordRail<T extends ExperienceRecordSelectionItem>(
  records: T[],
  selected: T | null
): T[] {
  if (!selected) return records
  const selectedKey = toRecordKey(selected)
  return [
    selected,
    ...records.filter((record) => toRecordKey(record) !== selectedKey),
  ]
}

function toRecordKey(record: ExperienceRecordSelectionItem) {
  return `${record.kind}:${record.id}`
}

function getFreshnessValue(record: ExperienceRecordSelectionItem) {
  return parseTimestamp(record.createdAt) || parseTimestamp(record.updatedAt)
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

import { LEGAL_LAST_UPDATED } from '@/lib/legal/constants'

export function DraftLegalBanner() {
  return (
    <div className="rounded-md border border-ochre bg-ochre-tint p-4 text-[14px] leading-6 text-ink">
      <p className="font-semibold">DRAFT - pending legal review</p>
      <p className="mt-1 text-ink-soft">
        These terms are placeholder operating copy for launch preparation and are subject to change after legal review.
        Last updated: {LEGAL_LAST_UPDATED}.
      </p>
    </div>
  )
}


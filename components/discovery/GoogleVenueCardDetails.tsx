'use client'
import { useEffect, useRef, useState } from 'react'
import type { VenueDetailsResult } from '@/lib/server/venue-places-details'

/** Owns Google presentation in component memory; never returns it to planner state. */
export function GoogleVenueCardDetails({ venueId, initial }: { venueId: string; initial?: VenueDetailsResult }) {
  const ref = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<VenueDetailsResult | null>(initial ?? null)
  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    setResult(initial ?? null)
    if (initial) return () => controller.abort()
    const load = async () => {
      try {
        const response = await fetch(`/api/planner/discovery-venues/${encodeURIComponent(venueId)}/card`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok || response.status === 204) return
        const payload = await response.json()
        if (!disposed && payload.venue_id === venueId) setResult(payload.google_live ?? null)
      } catch { /* Optional presentation cannot block independent actions. */ }
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void load() }
    })
    if (observer && ref.current) observer.observe(ref.current)
    else void load()
    return () => { disposed = true; controller.abort(); observer?.disconnect() }
  }, [venueId, initial])
  const place = result?.status === 'available' ? result.place : null
  return <div ref={ref} aria-label="Live venue details">
    {place ? <div className="space-y-2 rounded-md border border-border bg-white p-3 text-sm text-[#1F1F1F]">
      <p className="font-semibold">{place.displayName?.text ?? 'Venue name unavailable'}</p>
      {place.formattedAddress ? <p>{place.formattedAddress}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="px-[10px] pb-[5px] pt-[10px]" translate="no">
          {/* Official unmodified attribution asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/google-maps-attribution.svg" alt="Google Maps" width={98} height={18} />
        </span>
        {safeUrl(place.googleMapsUri) ? <a href={safeUrl(place.googleMapsUri)!} target="_blank" rel="noopener noreferrer" className="underline">View on Google Maps</a> : null}
        {place.attributions?.map((credit, index) => safeUrl(credit.providerUri) ? <a key={index} href={safeUrl(credit.providerUri)!} target="_blank" rel="noopener noreferrer" className="underline">{credit.provider ?? 'Source'}</a> : <span key={index}>{credit.provider}</span>)}
      </div>
    </div> : <p className="text-xs text-muted-foreground">Live venue details unavailable</p>}
  </div>
}
function safeUrl(input?: string): string | null {
  try { const url = new URL(input?.startsWith('//') ? `https:${input}` : input ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { GooglePlacesAttribution } from './foundation/GooglePlacesAttribution'
import { readGooglePlacesPhotoResponse, type GooglePhotoEntityType, type GooglePlacesPhotoResponse } from '@/lib/discovery/googlePhoto'

type GooglePlacesPhotoProps = {
  entityType: GooglePhotoEntityType
  entityId: string
  alt: string
  index?: number
}

type PhotoState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; response: GooglePlacesPhotoResponse }

export function GooglePlacesPhoto({ index = 0, ...props }: GooglePlacesPhotoProps) {
  // A different identity cannot retain the previous image while its effect cleans up.
  return <PhotoInteraction key={`${props.entityType}:${props.entityId}:${index}`} {...props} index={index} />
}

function PhotoInteraction({ entityType, entityId, alt, index }: Required<GooglePlacesPhotoProps>) {
  const [state, setState] = useState<PhotoState>({ status: 'idle' })
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  async function showPhoto() {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'loading' })

    try {
      const collection = entityType === 'discovery_venue' ? 'discovery-venues' : 'discovery-vendors'
      const response = await fetch(`/api/planner/${collection}/${encodeURIComponent(entityId)}/photo/${index}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const photo = response.ok && response.status !== 204
        ? readGooglePlacesPhotoResponse(await response.json(), { entityType, entityId, index })
        : null
      if (controller.signal.aborted || activeRequest.current !== controller) return
      setState(photo ? { status: 'ready', response: photo } : { status: 'unavailable' })
    } catch {
      if (!controller.signal.aborted && activeRequest.current === controller) setState({ status: 'unavailable' })
    }
  }

  function hidePhoto() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setState({ status: 'idle' })
  }

  if (state.status === 'unavailable') return null

  return (
    <div data-sentry-block>
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={state.status === 'idle' ? showPhoto : hidePhoto}
          className="rounded text-sm text-foreground underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={`${state.status === 'idle' ? 'View' : 'Hide'} photo of ${alt}`}
          aria-expanded={state.status !== 'idle'}
        >
          {state.status === 'idle' ? 'View photo' : 'Hide photo'}
        </button>
        {state.status === 'loading' ? <span role="status" className="text-xs text-muted-foreground">Loading photo…</span> : null}
      </div>
      {state.status === 'ready' ? (
        <figure>
          {/* A fresh data URL bypasses the image optimizer and any remote image cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.response.dataUrl}
            alt={alt}
            className="h-40 w-full object-cover"
            onError={() => setState({ status: 'unavailable' })}
          />
          <figcaption><GooglePlacesAttribution photo={state.response.attribution} /></figcaption>
        </figure>
      ) : null}
    </div>
  )
}

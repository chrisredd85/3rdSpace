import { parseGooglePhotoAttribution } from '@/lib/discovery/foundation/attribution'

type GooglePlacesAttributionProps = {
  /** One fresh photo object, not the enclosing Place response. */
  photo: unknown
}

/** Dormant credit-only view; the future photo flow must pair it with the same image. */
export function GooglePlacesAttribution({ photo }: GooglePlacesAttributionProps) {
  const attribution = parseGooglePhotoAttribution(photo)

  return (
    <div aria-label="Google Maps attribution" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink">
      <span className="font-medium">Google Maps</span>
      {attribution?.authorAttributions.map((author, index) => (
        author.uri ? (
          <a
            key={index}
            href={author.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {author.displayName ?? 'Contributor profile'}
          </a>
        ) : (
          <span key={index}>{author.displayName}</span>
        )
      ))}
      {attribution?.googleMapsUri ? (
        <a
          href={attribution.googleMapsUri}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          View photo on Google Maps
        </a>
      ) : null}
    </div>
  )
}

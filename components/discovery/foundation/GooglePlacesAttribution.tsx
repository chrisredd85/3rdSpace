import { parseGooglePhotoAttribution } from '@/lib/discovery/foundation/attribution'

type GooglePlacesAttributionProps = {
  /** One fresh photo object, not the enclosing Place response. */
  photo: unknown
}

/** Compact photo caption; supplied alongside the bytes from the same fresh response. */
export function GooglePlacesAttribution({ photo }: GooglePlacesAttributionProps) {
  const attribution = parseGooglePhotoAttribution(photo)

  return (
    <div aria-label="Google Maps attribution" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white p-3 font-sans text-xs text-[#1F1F1F]">
      <span className="shrink-0 px-[10px] pb-[5px] pt-[10px]" translate="no">
        {/* Official unmodified branding is a local static asset, not Places photo content. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/google-maps-attribution.svg" alt="Google Maps" width={98} height={18} className="h-[18px] w-[98px]" />
      </span>
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

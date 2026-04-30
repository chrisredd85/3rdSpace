'use client'

import Image from 'next/image'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface OptimizedImageProps {
  /**
   * Image source URL
   */
  src: string
  /**
   * Image alt text
   */
  alt: string
  /**
   * Image width
   */
  width: number
  /**
   * Image height
   */
  height: number
  /**
   * Whether to lazy load (default: true)
   */
  loading?: 'lazy' | 'eager'
  /**
   * Priority loading (for above-fold images)
   */
  priority?: boolean
  /**
   * Additional CSS classes
   */
  className?: string
  /**
   * Object fit style
   */
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  /**
   * Placeholder blur data URL
   */
  blurDataURL?: string
  /**
   * Fill container instead of fixed dimensions
   */
  fill?: boolean
}

/**
 * OptimizedImage component using Next.js Image
 * 
 * Automatically optimizes images with:
 * - WebP/AVIF format conversion
 * - Responsive sizing
 * - Lazy loading
 * - Blur placeholder
 * 
 * @example
 * ```tsx
 * <OptimizedImage
 *   src="/venue-photo.jpg"
 *   alt="Venue photo"
 *   width={400}
 *   height={300}
 *   loading="lazy"
 * />
 * ```
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  loading = 'lazy',
  priority = false,
  className,
  objectFit = 'cover',
  blurDataURL,
  fill = false,
}: OptimizedImageProps) {
  const [imageError, setImageError] = useState(false)

  // Fallback for external images or errors
  if (imageError || (!src.startsWith('/') && !src.startsWith('http'))) {
    return (
      <div
        className={cn('bg-sidebar-accent flex items-center justify-center', className)}
        style={fill ? undefined : { width, height }}
      >
        <span className="text-muted-foreground/60 text-sm">Image not available</span>
      </div>
    )
  }

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={cn(className, `object-${objectFit}`)}
        loading={loading}
        priority={priority}
        placeholder={blurDataURL ? 'blur' : 'empty'}
        blurDataURL={blurDataURL}
        onError={() => setImageError(true)}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      />
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={cn(className, `object-${objectFit}`)}
      loading={loading}
      priority={priority}
      placeholder={blurDataURL ? 'blur' : 'empty'}
      blurDataURL={blurDataURL}
      onError={() => setImageError(true)}
    />
  )
}

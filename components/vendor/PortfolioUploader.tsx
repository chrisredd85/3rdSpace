'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'

interface PortfolioUploaderProps {
  serviceId: string
  images: string[]
  maxImages?: number
  onUploaded: () => void
}

/**
 * Converts a storage path into a public image URL.
 *
 * @param path - Stored image path or public URL.
 * @returns Public image URL.
 */
function getImageUrl(path: string) {
  if (path.startsWith('http')) return path
  return supabase.storage.from('vendor-photos').getPublicUrl(path).data.publicUrl
}

/**
 * Drag/drop portfolio image uploader for a service listing.
 *
 * @param props - Service id, current images, limit, and refresh callback.
 * @returns Portfolio upload control.
 */
export function PortfolioUploader({ serviceId, images, maxImages = 10, onUploaded }: PortfolioUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const remaining = Math.max(maxImages - images.length, 0)

  /**
   * Uploads selected image files to the service portfolio endpoint.
   *
   * @param files - Files selected by input or drop.
   */
  async function uploadFiles(files: FileList | File[]) {
    const fileList = Array.from(files).slice(0, remaining)
    if (fileList.length === 0) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      fileList.forEach((file) => formData.append('photos', file))

      const response = await fetch(`/api/vendor/services/${serviceId}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload portfolio photos')
      }

      onUploaded()
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      {images.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((image) => (
            <div
              key={image}
              role="img"
              aria-label="Service portfolio"
              className="aspect-square rounded-md bg-cover bg-center"
              style={{ backgroundImage: `url(${getImageUrl(image)})` }}
            />
          ))}
        </div>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          uploadFiles(event.dataTransfer.files).catch(console.error)
        }}
        className={`rounded-lg border border-dashed p-4 text-center ${isDragging ? 'border-clay bg-clay/10' : 'border-tan bg-cream'}`}
      >
        <ImagePlus className="mx-auto h-6 w-6 text-ink-soft/60" />
        <p className="mt-2 text-sm font-medium text-ink">
          {remaining > 0 ? `Add portfolio photos (${remaining} slots left)` : 'Portfolio limit reached'}
        </p>
        <p className="mt-1 text-xs text-ink-soft">Drag images here or choose files.</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={isUploading || remaining === 0}
          onChange={(event) => {
            if (event.target.files) uploadFiles(event.target.files).catch(console.error)
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={isUploading || remaining === 0}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {isUploading ? 'Uploading...' : 'Choose Photos'}
        </Button>
      </div>
    </div>
  )
}

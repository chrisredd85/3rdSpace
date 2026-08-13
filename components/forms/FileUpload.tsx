'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { useErrorHandler } from '@/lib/hooks/useErrorHandler'
import { formatErrorMessage } from '@/lib/utils/errorHandling'

export interface FileUploadProps {
  /**
   * Accepted file types (e.g., 'image/*', '.pdf')
   */
  accept?: string
  /**
   * Maximum file size in bytes
   */
  maxSize?: number
  /**
   * Storage bucket name in Supabase
   */
  bucket: string
  /**
   * Folder path within the bucket
   */
  folderPath: string
  /**
   * Callback when file is uploaded successfully
   */
  onUploadComplete?: (url: string) => void
  /**
   * Callback when upload fails
   */
  onUploadError?: (error: Error) => void
  /**
   * Whether multiple files are allowed
   */
  multiple?: boolean
  /**
   * Current file URLs (for preview)
   */
  existingFiles?: string[]
  /**
   * Callback when file is removed
   */
  onRemove?: (url: string) => void
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * FileUpload component for uploading files to Supabase Storage
 * 
 * @example
 * ```tsx
 * <FileUpload
 *   bucket="vendor-photos"
 *   folderPath="vendor-123"
 *   accept="image/*"
 *   onUploadComplete={(url) => setPhotoUrl(url)}
 * />
 * ```
 */
export function FileUpload({
  accept = 'image/*',
  maxSize = 5 * 1024 * 1024, // 5MB default
  bucket,
  folderPath,
  onUploadComplete,
  onUploadError,
  multiple = false,
  existingFiles = [],
  onRemove,
  className,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewUrls, setPreviewUrls] = useState<string[]>(existingFiles)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { handleError } = useErrorHandler()

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const file = files[0]
    
    // Validate file size
    if (file.size > maxSize) {
      const error = new Error(`File size exceeds ${(maxSize / 1024 / 1024).toFixed(1)}MB limit`)
      setUploadError(error.message)
      onUploadError?.(error)
      handleError(error, 'File upload failed', { showToast: true })
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `${folderPath}/${fileName}`

      // Upload to Supabase Storage
      // Note: Supabase doesn't provide progress callbacks, so we simulate progress
      const uploadPromise = supabase.storage.from(bucket).upload(filePath, file)
      
      // Simulate progress (since Supabase doesn't provide it)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev
          return prev + 10
        })
      }, 200)

      const { error: uploadError } = await uploadPromise
      clearInterval(progressInterval)

      if (uploadError) throw uploadError

      setUploadProgress(100)

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(filePath)

      setPreviewUrls((prev) => [...prev, publicUrl])
      onUploadComplete?.(publicUrl)
      
      // Reset progress after a moment
      setTimeout(() => {
        setUploadProgress(0)
      }, 1000)
    } catch (error) {
      const errorMessage = formatErrorMessage(error)
      setUploadError(errorMessage)
      onUploadError?.(error as Error)
      handleError(error, 'File upload failed', { showToast: true })
      setUploadProgress(0)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemove = async (url: string) => {
    // Extract file path from URL
    const urlParts = url.split('/')
    const fileName = urlParts[urlParts.length - 1]
    const filePath = `${folderPath}/${fileName}`

    try {
      const { error } = await supabase.storage.from(bucket).remove([filePath])
      if (error) throw error
      setPreviewUrls((prev) => prev.filter((u) => u !== url))
      onRemove?.(url)
    } catch (error) {
      const errorMessage = formatErrorMessage(error)
      setUploadError(errorMessage)
      onUploadError?.(error as Error)
      handleError(error, 'Failed to remove file', { showToast: true })
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileSelect}
          disabled={uploading}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-4 w-4 mr-2" />
          {uploading ? 'Uploading...' : 'Upload File'}
        </Button>
      </div>

      {uploading && (
        <div className="space-y-2">
          <ProgressBar value={uploadProgress} showLabel />
          <p className="text-sm text-muted-foreground">Uploading file...</p>
        </div>
      )}

      {uploadError && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{uploadError}</p>
        </div>
      )}

      {previewUrls.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {previewUrls.map((url, index) => (
            <div key={index} className="relative group">
              {accept.includes('image') ? (
                <Image
                  src={url}
                  alt={`Upload ${index + 1}`}
                  width={256}
                  height={128}
                  unoptimized
                  className="w-full h-32 object-cover rounded-lg border border-border"
                />
              ) : (
                <div className="w-full h-32 bg-sidebar-accent/40 rounded-lg border border-border flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-2 right-2 bg-destructive/100 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

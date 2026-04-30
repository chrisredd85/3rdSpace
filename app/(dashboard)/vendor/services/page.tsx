'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ExternalLink, FileText, Loader2, Save, Trash2, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileUpload } from '@/components/forms/FileUpload'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { VendorServicesManager } from '@/components/vendor/VendorServicesManager'
import type { ServiceType } from '@/lib/types'

const serviceAreaOptions = [
  { value: 'all_bay_area', label: 'All Bay Area' },
  { value: 'sf_only', label: 'San Francisco only' },
  { value: 'east_bay', label: 'East Bay' },
  { value: 'south_bay', label: 'South Bay' },
  { value: 'north_bay', label: 'North Bay' },
] as const

const vendorSchema = z.object({
  business_name: z.string().min(2, 'Business name must be at least 2 characters'),
  description: z.string().optional(),
  service_type: z.enum([
    'dj',
    'catering',
    'bartending',
    'photography',
    'videography',
    'av_tech',
    'event_planning',
    'florist',
    'other',
  ]),
  service_area: z.enum(['all_bay_area', 'sf_only', 'east_bay', 'south_bay', 'north_bay']),
  setup_time: z.enum(['30', '60', '90', '120', '180']),
})

type VendorFormData = z.infer<typeof vendorSchema>

type VendorProfile = {
  id: string
  name: string
  bio: string | null
  service_type: ServiceType | null
  service_area: VendorFormData['service_area'] | null
  setup_time_minutes: number | null
  photo_url: string | null
}

type VendorDocumentRow = {
  id: string
  file_name: string | null
  file_url: string
  mime_type: string | null
  file_size: number | null
}

type VendorDocument = {
  id: string
  name: string
  filePath: string
  url: string | null
  mimeType: string | null
  size: number | null
}

function getVendorType(serviceType: ServiceType): string {
  switch (serviceType) {
    case 'dj':
      return 'DJ / Music'
    case 'bartending':
      return 'Bartender'
    case 'photography':
      return 'Photographer'
    case 'catering':
      return 'Caterer'
    case 'av_tech':
      return 'Audio/Visual Tech'
    case 'florist':
      return 'Decorator / Florist'
    default:
      return 'Security / Event Staff'
  }
}

export default function VendorServicesPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorPhotoUrl, setVendorPhotoUrl] = useState<string | null>(null)
  const [documents, setDocuments] = useState<VendorDocument[]>([])
  const [isVendorLoading, setIsVendorLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingDocs, setIsUploadingDocs] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      business_name: '',
      description: '',
      service_type: 'dj',
      service_area: 'all_bay_area',
      setup_time: '60',
    },
  })

  useEffect(() => {
    let isMounted = true

    const loadVendor = async () => {
      if (!user?.id) {
        setIsVendorLoading(false)
        return
      }

      setIsVendorLoading(true)

      const { data: vendor, error: vendorError } = await supabase
        .from('vendor_profiles')
        .select('id, name, bio, service_type, service_area, setup_time_minutes, photo_url')
        .eq('user_id', user.id)
        .maybeSingle()

      if (vendorError) {
        if (isMounted) {
          addToast({
            title: 'Could not load vendor profile',
            description: vendorError.message,
            variant: 'destructive',
          })
          setIsVendorLoading(false)
        }
        return
      }

      const profile = vendor as VendorProfile | null
      if (!profile) {
        if (isMounted) {
          setVendorId(null)
          setVendorPhotoUrl(null)
          setDocuments([])
          setIsVendorLoading(false)
        }
        return
      }

      if (isMounted) {
        setVendorId(profile.id)
        setVendorPhotoUrl(profile.photo_url)
        reset({
          business_name: profile.name || '',
          description: profile.bio || '',
          service_type: (profile.service_type || 'dj') as VendorFormData['service_type'],
          service_area: (profile.service_area || 'all_bay_area') as VendorFormData['service_area'],
          setup_time: String(profile.setup_time_minutes || 60) as VendorFormData['setup_time'],
        })
      }

      const { data: rawDocuments, error: documentsError } = await supabase
        .from('documents')
        .select('id, file_name, file_url, mime_type, file_size')
        .eq('related_type', 'user')
        .eq('related_id', user.id)
        .order('created_at', { ascending: false })

      if (documentsError) {
        if (isMounted) {
          addToast({
            title: 'Could not load vendor documents',
            description: documentsError.message,
            variant: 'destructive',
          })
        }
      } else {
        const docs = await Promise.all(
          ((rawDocuments as VendorDocumentRow[] | null) || []).map(async (doc) => {
            const { data: signedUrlData } = await supabase.storage
              .from('vendor-documents')
              .createSignedUrl(doc.file_url, 60 * 60)

            return {
              id: doc.id,
              name: doc.file_name || doc.file_url.split('/').pop() || 'Document',
              filePath: doc.file_url,
              url: signedUrlData?.signedUrl || null,
              mimeType: doc.mime_type,
              size: doc.file_size,
            } satisfies VendorDocument
          })
        )

        if (isMounted) {
          setDocuments(docs)
        }
      }

      if (isMounted) {
        setIsVendorLoading(false)
      }
    }

    loadVendor()

    return () => {
      isMounted = false
    }
  }, [addToast, reset, user?.id])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">Please log in to continue</div>
      </div>
    )
  }

  const handleSave = async (data: VendorFormData) => {
    if (!vendorId) return

    setIsSaving(true)
    try {
      const { error: updateError } = await supabase
        .from('vendor_profiles')
        .update({
          name: data.business_name,
          bio: data.description || null,
          service_type: data.service_type,
          service_area: data.service_area,
          regions_served: data.service_area,
          vendor_type: getVendorType(data.service_type),
          setup_time_minutes: Number(data.setup_time),
          updated_at: new Date().toISOString(),
        })
        .eq('id', vendorId)

      if (updateError) throw updateError

      addToast({
        title: 'Profile updated',
        description: 'Your vendor profile details have been saved.',
        variant: 'success',
      })

      reset(data)
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update services',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handlePhotoUploadComplete = async (url: string) => {
    if (!vendorId) return

    const { error } = await supabase
      .from('vendor_profiles')
      .update({
        photo_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vendorId)

    if (error) {
      addToast({
        title: 'Photo upload saved to storage but not to profile',
        description: error.message,
        variant: 'warning',
      })
      return
    }

    setVendorPhotoUrl(url)
    addToast({
      title: 'Photo updated',
      description: 'Your vendor profile image is live.',
      variant: 'success',
    })
  }

  const handlePhotoRemove = async () => {
    if (!vendorId) return

    const { error } = await supabase
      .from('vendor_profiles')
      .update({
        photo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vendorId)

    if (error) {
      addToast({
        title: 'Could not update vendor photo',
        description: error.message,
        variant: 'destructive',
      })
      return
    }

    setVendorPhotoUrl(null)
    addToast({
      title: 'Photo removed',
      description: 'Your vendor profile image has been cleared.',
    })
  }

  const handleVendorDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !vendorId) return

    setIsUploadingDocs(true)
    try {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !authUser) {
        throw new Error('Please log in again before uploading files.')
      }

      const uploaded: VendorDocument[] = []

      for (const file of Array.from(files)) {
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const filePath = `${vendorId}/${Date.now()}-${sanitizedName}`

        const { error: uploadError } = await supabase.storage
          .from('vendor-documents')
          .upload(filePath, file, { upsert: false })

        if (uploadError) throw uploadError

        const { data: documentRow, error: insertError } = await supabase
          .from('documents')
          .insert({
            uploader_id: authUser.id,
            related_type: 'user',
            related_id: authUser.id,
            document_type: 'other',
            file_name: file.name,
            file_url: filePath,
            file_size: file.size,
            mime_type: file.type || null,
          })
          .select('id, file_name, file_url, mime_type, file_size')
          .single()

        if (insertError) {
          await supabase.storage.from('vendor-documents').remove([filePath])
          throw insertError
        }

        const row = documentRow as VendorDocumentRow
        const { data: signedUrlData } = await supabase.storage
          .from('vendor-documents')
          .createSignedUrl(filePath, 60 * 60)

        uploaded.push({
          id: row.id,
          name: row.file_name || file.name,
          filePath: row.file_url,
          url: signedUrlData?.signedUrl || null,
          mimeType: row.mime_type,
          size: row.file_size,
        })
      }

      setDocuments((current) => [...uploaded, ...current])
      addToast({
        title: 'Documents uploaded',
        description: `${uploaded.length} vendor file${uploaded.length === 1 ? '' : 's'} uploaded.`,
        variant: 'success',
      })
    } catch (error) {
      addToast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Could not upload vendor documents',
        variant: 'destructive',
      })
    } finally {
      setIsUploadingDocs(false)
      e.target.value = ''
    }
  }

  const handleVendorDocumentDelete = async (document: VendorDocument) => {
    setDeletingDocId(document.id)
    try {
      const { error: storageError } = await supabase.storage
        .from('vendor-documents')
        .remove([document.filePath])

      if (storageError) throw storageError

      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', document.id)

      if (deleteError) throw deleteError

      setDocuments((current) => current.filter((item) => item.id !== document.id))
      addToast({
        title: 'Document removed',
        description: `${document.name} has been deleted.`,
      })
    } catch (error) {
      addToast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Could not delete vendor document',
        variant: 'destructive',
      })
    } finally {
      setDeletingDocId(null)
    }
  }

  if (isVendorLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading services...</p>
        </div>
      </div>
    )
  }

  if (!vendorId) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No vendor profile found. Please complete vendor onboarding first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Service Listing</h1>
        <p className="text-muted-foreground mt-1">Manage your vendor profile, bookable services, portfolio, and private documents.</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Essential details about your service business
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Business Name *
              </label>
              <Input
                {...register('business_name')}
                placeholder="DJ Services Co."
              />
              {errors.business_name && (
                <p className="text-sm text-destructive mt-1">{errors.business_name.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Description
              </label>
              <textarea
                {...register('description')}
                rows={4}
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Describe your services, experience, and what makes you unique..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Service Type *
                </label>
                <select
                  {...register('service_type')}
                  className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="dj">DJ</option>
                  <option value="catering">Catering</option>
                  <option value="bartending">Bartending</option>
                  <option value="photography">Photography</option>
                  <option value="videography">Videography</option>
                  <option value="av_tech">AV Tech</option>
                  <option value="event_planning">Event Planning</option>
                  <option value="florist">Florist</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Service Area *
                </label>
                <select
                  {...register('service_area')}
                  className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  {serviceAreaOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.service_area && (
                  <p className="text-sm text-destructive mt-1">{errors.service_area.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Setup Time Required
              </label>
              <select
                {...register('setup_time')}
                className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="30">30 minutes</option>
                <option value="60">60 minutes (1 hour)</option>
                <option value="90">90 minutes (1.5 hours)</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile Photo</CardTitle>
            <CardDescription>
              Upload one public-facing image for your vendor listing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUpload
              key={vendorPhotoUrl || 'empty-photo'}
              bucket="vendor-photos"
              folderPath={vendorId}
              accept="image/jpeg,image/png,image/webp"
              maxSize={5 * 1024 * 1024}
              existingFiles={vendorPhotoUrl ? [vendorPhotoUrl] : []}
              onUploadComplete={handlePhotoUploadComplete}
              onRemove={handlePhotoRemove}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Private Documents</CardTitle>
            <CardDescription>
              Keep COIs, menus, pricing decks, or setup docs in a vendor-only bucket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={handleVendorDocumentUpload}
                  disabled={isUploadingDocs}
                  className="hidden"
                />
                <Button variant="outline" asChild>
                  <span>
                    {isUploadingDocs ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    {isUploadingDocs ? 'Uploading...' : 'Upload Private Documents'}
                  </span>
                </Button>
              </label>
            </div>

            {documents.length > 0 ? (
              <div className="space-y-2">
                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{document.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {document.mimeType || 'Document'}
                        {document.size ? ` • ${(document.size / 1024 / 1024).toFixed(1)} MB` : ''}
                      </p>
                    </div>
                    {document.url && (
                      <Button variant="ghost" size="icon" asChild>
                        <a href={document.url} target="_blank" rel="noreferrer" aria-label={`Open ${document.name}`}>
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={deletingDocId === document.id}
                      onClick={() => handleVendorDocumentDelete(document)}
                      aria-label={`Delete ${document.name}`}
                    >
                      {deletingDocId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                No private vendor documents uploaded yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSaving || !isDirty}
          >
            {isSaving ? (
              'Saving...'
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Bookable Services & Portfolio</CardTitle>
          <CardDescription>
            Build polished service listings with price, duration, add-ons, equipment, and photos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VendorServicesManager vendorId={vendorId} />
        </CardContent>
      </Card>
    </div>
  )
}

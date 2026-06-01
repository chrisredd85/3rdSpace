'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ExternalLink, FileText, Loader2, Save, Trash2, Upload, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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

const optionalNumber = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}, z.number().min(0).nullable())

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
  is_published: z.boolean(),
  base_rate: optionalNumber,
  deposit_percentage: optionalNumber,
  lead_time_days: optionalNumber,
  availability_notes: z.string().optional(),
  cancellation_terms: z.string().optional(),
  emergency_available: z.boolean(),
  emergency_rate_uplift: optionalNumber,
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
  is_published: boolean | null
  base_rate: number | null
  deposit_percentage: number | null
  requires_deposit: boolean | null
  lead_time_days: number | null
  availability_notes: string | null
  cancellation_terms: string | null
  emergency_available: boolean | null
  emergency_rate_uplift: number | null
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
    watch,
    setValue,
  } = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      business_name: '',
      description: '',
      service_type: 'dj',
      service_area: 'all_bay_area',
      setup_time: '60',
      is_published: true,
      base_rate: null,
      deposit_percentage: 30,
      lead_time_days: 7,
      availability_notes: '',
      cancellation_terms: '',
      emergency_available: false,
      emergency_rate_uplift: null,
    },
  })
  const isPublished = watch('is_published')
  const emergencyAvailable = watch('emergency_available')

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
        .select('id, name, bio, service_type, service_area, setup_time_minutes, photo_url, is_published, base_rate, deposit_percentage, requires_deposit, lead_time_days, availability_notes, cancellation_terms, emergency_available, emergency_rate_uplift')
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
          is_published: profile.is_published !== false,
          base_rate: profile.base_rate ?? null,
          deposit_percentage: profile.deposit_percentage ?? null,
          lead_time_days: profile.lead_time_days ?? null,
          availability_notes: profile.availability_notes || '',
          cancellation_terms: profile.cancellation_terms || '',
          emergency_available: profile.emergency_available === true,
          emergency_rate_uplift: profile.emergency_rate_uplift ?? null,
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
        <div className="text-ink-soft">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-brick">Please log in to continue</div>
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
          is_published: data.is_published,
          base_rate: data.base_rate,
          deposit_percentage: data.deposit_percentage,
          requires_deposit: typeof data.deposit_percentage === 'number' && data.deposit_percentage > 0,
          lead_time_days: data.lead_time_days,
          availability_notes: data.availability_notes || null,
          cancellation_terms: data.cancellation_terms || null,
          emergency_available: data.emergency_available,
          emergency_rate_uplift: data.emergency_available ? data.emergency_rate_uplift : null,
          updated_at: new Date().toISOString(),
        } as never)
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
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent mx-auto mb-4" />
          <p className="text-ink-soft">Loading services...</p>
        </div>
      </div>
    )
  }

  if (!vendorId) {
    return (
      <div className="text-center py-12">
        <p className="text-ink-soft">No vendor profile found. Please complete vendor onboarding first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Service Listing</h1>
        <p className="text-ink-soft mt-1">Run your vendor profile, bookable services, portfolio, and private documents.</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Planner Visibility</CardTitle>
            <CardDescription>
              Control whether builders can discover this vendor while composing an event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 rounded-lg border border-tan bg-cream/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">Make service visible to event planners</p>
                <p className="text-sm text-ink-soft">Visible services appear in the 3rdPlace event planner and recommendation flow.</p>
              </div>
              <Switch
                checked={Boolean(isPublished)}
                disabled={isSaving}
                onCheckedChange={(checked) => setValue('is_published', checked, { shouldDirty: true })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Essential details about your service business
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Business Name *
              </label>
              <Input
                {...register('business_name')}
                placeholder="DJ Services Co."
              />
              {errors.business_name && (
                <p className="text-sm text-brick mt-1">{errors.business_name.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Description
              </label>
              <textarea
                {...register('description')}
                rows={4}
                className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
                placeholder="Describe your services, experience, and what makes you unique..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Service Type *
                </label>
                <select
                  {...register('service_type')}
                  className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
                >
                  <option value="dj">DJ</option>
                  <option value="catering">Catering</option>
                  <option value="bartending">Bartending</option>
                  <option value="photography">Photography</option>
                  <option value="videography">Videography</option>
                  <option value="av_tech">AV Tech</option>
                  <option value="event_planning">Event Production</option>
                  <option value="florist">Florist</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Service Area *
                </label>
                <select
                  {...register('service_area')}
                  className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
                >
                  {serviceAreaOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.service_area && (
                  <p className="text-sm text-brick mt-1">{errors.service_area.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Setup Time Required
              </label>
              <select
                {...register('setup_time')}
                className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
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
            <CardTitle>Booking Terms</CardTitle>
            <CardDescription>
              Set the pricing, deposit, lead time, and availability signals builders need before outreach.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-ink">Base / starting price ($)</label>
                <Input type="number" step="1" {...register('base_rate')} placeholder="950" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-ink">Deposit required (%)</label>
                <Input type="number" step="1" {...register('deposit_percentage')} placeholder="30" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-ink">Minimum lead time (days)</label>
                <Input type="number" step="1" {...register('lead_time_days')} placeholder="7" />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-ink">Availability notes</label>
              <textarea
                {...register('availability_notes')}
                rows={3}
                className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
                placeholder="Available Tuesday-Saturday. Can handle same-week panel AV when gear is in town."
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-ink">Cancellation terms</label>
              <textarea
                {...register('cancellation_terms')}
                rows={2}
                className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
                placeholder="Refundable until seven days out, then 50% deposit retained."
              />
            </div>

            <div className="rounded-lg border border-forest/40 bg-forest/5 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <Zap className="mt-0.5 h-4 w-4 text-forest" />
                  <div>
                    <p className="font-medium text-ink">Available as an emergency vendor</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      Let planners flag you for last-minute replacement requests at a higher rate.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={Boolean(emergencyAvailable)}
                  disabled={isSaving}
                  onCheckedChange={(checked) => setValue('emergency_available', checked, { shouldDirty: true })}
                />
              </div>
              {emergencyAvailable ? (
                <div className="mt-4 max-w-xs">
                  <label className="mb-2 block text-sm font-medium text-ink">Emergency-rate uplift (%)</label>
                  <Input type="number" step="1" {...register('emergency_rate_uplift')} placeholder="25" />
                </div>
              ) : null}
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
                    className="flex items-center gap-3 rounded-lg border border-tan p-3"
                  >
                    <FileText className="h-5 w-5 text-ink-soft/60" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{document.name}</p>
                      <p className="text-xs text-ink-soft">
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
              <div className="rounded-lg border border-dashed border-tan p-6 text-sm text-ink-soft">
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

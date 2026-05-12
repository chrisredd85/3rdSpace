'use client'

import { useState } from 'react'
import { RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type CatalogKind = 'venues' | 'vendors'

interface AdminCatalogConsoleProps {
  kind: CatalogKind
  initialRows: Array<Record<string, any>>
}

const serviceTypes = ['dj', 'catering', 'bartending', 'photography', 'videography', 'av_tech', 'event_planning', 'florist', 'other']

/**
 * Admin catalog seeding console for venues and vendors.
 */
export function AdminCatalogConsole({ kind, initialRows }: AdminCatalogConsoleProps) {
  const [rows, setRows] = useState(initialRows)
  const [form, setForm] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const isVenue = kind === 'venues'

  function updateField(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function refresh() {
    const response = await fetch(`/api/admin/catalog/${kind}`, { credentials: 'include' })
    const data = await response.json()
    if (response.ok) setRows((data[kind] ?? []) as Array<Record<string, any>>)
  }

  async function submit() {
    setIsSaving(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/catalog/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(kind, form)),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || 'Unable to save catalog row')
        return
      }
      setForm({})
      setMessage('Saved. Catalog row is ready for admin review.')
      await refresh()
    } finally {
      setIsSaving(false)
    }
  }

  async function updatePublishState(row: Record<string, any>, isPublished: boolean) {
    const id = String(row.id ?? '')
    if (!id) return

    setPublishingId(id)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/catalog/${kind}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_published: isPublished }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || 'Unable to update catalog visibility')
        return
      }

      const updatedRow = (data[isVenue ? 'venue' : 'vendor'] ?? { ...row, is_published: isPublished }) as Record<string, any>
      setRows((current) => current.map((item) => (String(item.id) === id ? updatedRow : item)))
      setMessage(`${getName(updatedRow, kind)} is now ${isPublished ? 'published' : 'unpublished'}.`)
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Admin catalog</p>
            <h1 className="mt-2 font-display text-3xl font-bold">{isVenue ? 'Venues & Bars' : 'Vendors'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Seed unclaimed listings, review claim state, and verify catalog quality.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-display text-xl font-bold">Add {isVenue ? 'venue' : 'vendor'}</h2>
            <div className="mt-4 grid gap-4">
              <Field label="Name" value={form.name} onChange={(value) => updateField('name', value)} />
              {isVenue ? (
                <>
                  <Field label="Neighborhood" value={form.neighborhood} onChange={(value) => updateField('neighborhood', value)} />
                  <Field label="Address" value={form.address} onChange={(value) => updateField('address', value)} />
                  <Field label="ZIP code" value={form.zip_code} onChange={(value) => updateField('zip_code', value)} />
                  <Field label="Capacity" value={form.capacity} onChange={(value) => updateField('capacity', value)} inputMode="numeric" />
                  <Field label="Hourly rate cents" value={form.hourly_rate} onChange={(value) => updateField('hourly_rate', value)} inputMode="numeric" />
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="service_type">Service type</Label>
                    <select
                      id="service_type"
                      value={form.service_type ?? 'catering'}
                      onChange={(event) => updateField('service_type', event.target.value)}
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm"
                    >
                      {serviceTypes.map((type) => (
                        <option key={type} value={type}>{formatLabel(type)}</option>
                      ))}
                    </select>
                  </div>
                  <Field label="Neighborhood or region" value={form.neighborhood} onChange={(value) => updateField('neighborhood', value)} />
                  <Field label="Price band" value={form.price_band} onChange={(value) => updateField('price_band', value)} placeholder="budget, mid, premium" />
                </>
              )}
              <Field label="Contact email" value={form.contact_email} onChange={(value) => updateField('contact_email', value)} />
              <div className="space-y-2">
                <Label htmlFor="notes">{isVenue ? 'Notes' : 'Package summary'}</Label>
                <Textarea
                  id="notes"
                  value={isVenue ? form.notes ?? '' : form.package_summary ?? ''}
                  onChange={(event) => updateField(isVenue ? 'notes' : 'package_summary', event.target.value)}
                />
              </div>
              {message ? (
                <p className={cn('text-sm', message.startsWith('Saved') ? 'text-primary' : 'text-destructive')}>{message}</p>
              ) : null}
              <Button type="button" onClick={submit} disabled={isSaving}>
                <Plus className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Add listing'}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Catalog rows</h2>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{rows.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Contact</th>
                    <th className="pb-2 pr-4">Claim</th>
                    <th className="pb-2 pr-4">Visibility</th>
                    <th className="pb-2 pr-4">Created</th>
                    <th className="pb-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, index) => (
                    <tr key={String(row.id ?? index)}>
                      <td className="max-w-[260px] truncate py-3 pr-4 font-medium" title={getName(row, kind)}>
                        {getName(row, kind)}
                      </td>
                      <td className="py-3 pr-4">{formatLabel(String(row.venue_type ?? row.service_type ?? row.vendor_type ?? 'catalog'))}</td>
                      <td className="max-w-[240px] truncate py-3 pr-4" title={String(row.contact_email ?? '')}>
                        {String(row.contact_email ?? 'No email')}
                      </td>
                      <td className="py-3 pr-4">{row.is_claimed ? 'Claimed' : 'Unclaimed'}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-medium',
                            row.is_published === false
                              ? 'border-border text-muted-foreground'
                              : 'border-primary/40 bg-primary/10 text-primary'
                          )}
                        >
                          {row.is_published === false ? 'Unpublished' : 'Published'}
                        </span>
                      </td>
                      <td className="py-3 pr-4">{formatDate(row.created_at)}</td>
                      <td className="py-3 pr-4 text-right">
                        <Button
                          type="button"
                          variant={row.is_published === false ? 'hero' : 'outline'}
                          size="sm"
                          disabled={publishingId === String(row.id)}
                          onClick={() => updatePublishState(row, row.is_published === false)}
                        >
                          {publishingId === String(row.id)
                            ? 'Saving...'
                            : row.is_published === false
                              ? 'Publish'
                              : 'Unpublish'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  label: string
  value?: string
  onChange: (value: string) => void
  inputMode?: 'numeric'
  placeholder?: string
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} inputMode={inputMode} placeholder={placeholder} />
    </div>
  )
}

function buildPayload(kind: CatalogKind, form: Record<string, string>) {
  if (kind === 'venues') {
    return {
      name: form.name,
      neighborhood: form.neighborhood,
      address: form.address,
      zip_code: form.zip_code,
      venue_type: 'other',
      capacity: Number(form.capacity || 0),
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      minimum_spend: null,
      contact_email: form.contact_email,
      av_included: false,
      per_head_kickback_amount: null,
      notes: form.notes || null,
    }
  }

  return {
    name: form.name,
    service_type: form.service_type || 'catering',
    neighborhood: form.neighborhood || null,
    price_band: ['budget', 'mid', 'premium'].includes(form.price_band) ? form.price_band : 'mid',
    contact_email: form.contact_email,
    package_summary: form.package_summary || null,
    lead_time_days: null,
    notes: form.notes || null,
  }
}

function getName(row: Record<string, any>, kind: CatalogKind) {
  return String(kind === 'venues' ? row.venue_name ?? row.name ?? 'Unnamed venue' : row.name ?? 'Unnamed vendor')
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (word) => (word.toUpperCase() === 'AV' ? 'AV' : word.charAt(0).toUpperCase() + word.slice(1)))
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return 'Unknown'
  return new Date(value).toLocaleDateString()
}

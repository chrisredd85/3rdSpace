'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, Loader2, Mail, Save, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PreferenceState = {
  email_enabled: boolean
  push_enabled: boolean
  sound_enabled: boolean
  preferences: Record<string, { email?: boolean; in_app?: boolean; push?: boolean }>
}

const notificationTypes = [
  { id: 'new_booking', label: 'New bookings' },
  { id: 'booking_approved', label: 'Booking approvals' },
  { id: 'booking_rejected', label: 'Booking rejections' },
  { id: 'booking_cancelled', label: 'Cancellations' },
  { id: 'new_message', label: 'Messages' },
  { id: 'payment_received', label: 'Payments' },
  { id: 'invoice_sent', label: 'Invoices' },
  { id: 'payment_due', label: 'Payment due' },
  { id: 'review_received', label: 'Reviews' },
  { id: 'review_request', label: 'Review requests' },
]

/**
 * Lets users manage channel-level and per-type notification preferences.
 */
export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<PreferenceState>({
    email_enabled: true,
    push_enabled: false,
    sound_enabled: false,
    preferences: {},
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadPreferences()
  }, [])

  /**
   * Loads current notification preferences.
   */
  async function loadPreferences() {
    setLoading(true)
    const response = await fetch('/api/notifications/preferences')
    const payload = await response.json().catch(() => ({}))
    if (response.ok && payload.preferences) setPreferences(payload.preferences)
    setLoading(false)
  }

  /**
   * Saves current notification preferences.
   */
  async function savePreferences() {
    setSaving(true)
    await fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    })
    setSaving(false)
  }

  /**
   * Toggles a top-level channel preference.
   */
  function toggleGlobal(key: keyof Pick<PreferenceState, 'email_enabled' | 'push_enabled' | 'sound_enabled'>) {
    setPreferences((current) => ({ ...current, [key]: !current[key] }))
  }

  /**
   * Toggles one channel for a notification type.
   */
  function toggleType(type: string, channel: 'email' | 'in_app' | 'push') {
    setPreferences((current) => {
      const currentType = current.preferences[type] || {}
      return {
        ...current,
        preferences: {
          ...current.preferences,
          [type]: {
            ...currentType,
            [channel]: currentType[channel] === false,
          },
        },
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border p-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading preferences...
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Notification Preferences</h2>
          <p className="text-sm text-muted-foreground">Choose which channels should notify you.</p>
        </div>
        <Button type="button" onClick={savePreferences} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <PreferenceToggle icon={<Mail className="h-4 w-4" />} label="Email" enabled={preferences.email_enabled} onClick={() => toggleGlobal('email_enabled')} />
        <PreferenceToggle icon={<Bell className="h-4 w-4" />} label="Push" enabled={preferences.push_enabled} onClick={() => toggleGlobal('push_enabled')} />
        <PreferenceToggle icon={<Volume2 className="h-4 w-4" />} label="Sound" enabled={preferences.sound_enabled} onClick={() => toggleGlobal('sound_enabled')} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_80px_80px_80px] bg-background px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>Type</span>
          <span>Email</span>
          <span>In-app</span>
          <span>Push</span>
        </div>
        {notificationTypes.map((type) => (
          <div key={type.id} className="grid grid-cols-[1fr_80px_80px_80px] items-center border-t border-border px-3 py-2 text-sm">
            <span className="font-medium text-foreground">{type.label}</span>
            <input type="checkbox" checked={preferences.preferences[type.id]?.email !== false} onChange={() => toggleType(type.id, 'email')} />
            <input type="checkbox" checked={preferences.preferences[type.id]?.in_app !== false} onChange={() => toggleType(type.id, 'in_app')} />
            <input type="checkbox" checked={preferences.preferences[type.id]?.push !== false} onChange={() => toggleType(type.id, 'push')} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Renders one global channel toggle.
 */
function PreferenceToggle({
  icon,
  label,
  enabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-lg border border-border p-3 text-left transition-colors hover:bg-background"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </span>
      <span className={enabled ? 'text-sm font-semibold text-primary' : 'text-sm text-muted-foreground'}>
        {enabled ? 'On' : 'Off'}
      </span>
    </button>
  )
}

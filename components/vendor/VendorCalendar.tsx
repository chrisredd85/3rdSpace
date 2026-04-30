'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Save } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AvailabilityLegend } from '@/components/vendor/AvailabilityLegend'
import type { VendorAvailability, VendorAvailabilityStatus } from '@/lib/types'

type CalendarView = 'month' | 'week'

interface VendorCalendarProps {
  vendorId: string
}

interface CalendarDay {
  date: string
  status: VendorAvailabilityStatus
  availability: VendorAvailability | null
  booking: { id: string; status: string; events?: { event_name?: string } | null } | null
  notes: string | null
}

interface AvailabilityResponse {
  days?: CalendarDay[]
  month?: { value: string }
  error?: string
}

const STATUS_STYLES: Record<VendorAvailabilityStatus, string> = {
  available: 'bg-card/40 border-border',
  tentative: 'bg-yellow-500/10 border-yellow-500/30',
  booked: 'bg-primary/10 border-primary/40',
  blocked: 'bg-destructive/10 border-red-300',
}

/**
 * Formats a date object as YYYY-MM-DD.
 *
 * @param date - Date to format.
 * @returns Date string.
 */
function formatDate(date: Date) {
  return date.toISOString().split('T')[0]
}

/**
 * Formats the current visible month.
 *
 * @param date - Date inside the month.
 * @returns YYYY-MM string.
 */
function formatMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Builds calendar grid dates for the current month.
 *
 * @param currentMonth - Month date.
 * @returns Grid dates including leading blanks.
 */
function buildMonthGrid(currentMonth: Date) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const days: Array<Date | null> = []

  for (let i = 0; i < firstDay.getDay(); i += 1) days.push(null)
  for (let day = 1; day <= lastDay.getDate(); day += 1) days.push(new Date(year, month, day))

  return days
}

/**
 * Returns the week containing the selected date.
 *
 * @param selected - Date in the target week.
 * @returns Seven dates from Sunday to Saturday.
 */
function buildWeek(selected: Date) {
  const start = new Date(selected)
  start.setDate(selected.getDate() - selected.getDay())
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

/**
 * Manual availability calendar for vendor owners.
 *
 * @param props - Vendor profile id.
 * @returns Interactive vendor availability calendar.
 */
export function VendorCalendar({ vendorId }: VendorCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [view, setView] = useState<CalendarView>('month')
  const [days, setDays] = useState<CalendarDay[]>([])
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const [status, setStatus] = useState<VendorAvailabilityStatus>('blocked')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const monthValue = formatMonth(currentMonth)

  /**
   * Loads month availability data.
   */
  const loadAvailability = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/vendor/availability?vendorId=${vendorId}&month=${monthValue}`, {
        credentials: 'include',
      })
      const data = (await response.json()) as AvailabilityResponse

      if (!response.ok) throw new Error(data.error || 'Failed to load availability')
      setDays(data.days || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load availability')
    } finally {
      setLoading(false)
    }
  }, [monthValue, vendorId])

  useEffect(() => {
    loadAvailability()
  }, [loadAvailability])

  const daysByDate = useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days]
  )

  const visibleDates = view === 'week'
    ? buildWeek(selectedDay ? new Date(`${selectedDay.date}T00:00:00`) : new Date())
    : buildMonthGrid(currentMonth)

  const utilization = useMemo(() => {
    if (days.length === 0) return 0
    const unavailable = days.filter((day) => day.status === 'booked' || day.status === 'blocked').length
    return Math.round((unavailable / days.length) * 100)
  }, [days])

  const isSelectedBookingControlled = Boolean(selectedDay?.booking || selectedDay?.availability?.booking_id)

  /**
   * Selects a date and prepares the edit panel.
   *
   * @param day - Calendar day.
   */
  function handleSelectDay(day: CalendarDay) {
    setSelectedDay(day)
    setStatus(day.status === 'available' ? 'blocked' : day.status)
    setNotes(day.notes || '')
  }

  /**
   * Saves the selected day status.
   */
  async function handleSaveStatus() {
    if (!selectedDay) return

    setSaving(true)
    setError(null)
    try {
      const payload = { vendorId, date: selectedDay.date, status, notes }
      const response = selectedDay.availability
        ? await fetch(`/api/vendor/availability/${selectedDay.availability.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ status, notes }),
          })
        : await fetch('/api/vendor/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save availability')

      await loadAvailability()
      setSelectedDay(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save availability')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/10">
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium text-primary">Unavailable Days - {monthLabel}</p>
            <p className="mt-1 text-2xl font-bold text-primary">{utilization}%</p>
          </div>
          <div className="rounded-full bg-primary p-4 text-white">
            <CalendarDays className="h-7 w-7" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>{monthLabel}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={view === 'month' ? 'default' : 'outline'} size="sm" onClick={() => setView('month')}>Month</Button>
              <Button variant={view === 'week' ? 'default' : 'outline'} size="sm" onClick={() => setView('week')}>Week</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AvailabilityLegend />
          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading calendar...
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="p-2 text-center text-sm font-semibold text-foreground">{day}</div>
              ))}

              {visibleDates.map((date, index) => {
                if (!date) return <div key={`empty-${index}`} className="aspect-square" />
                const dateString = formatDate(date)
                const day = daysByDate.get(dateString) || {
                  date: dateString,
                  status: 'available' as VendorAvailabilityStatus,
                  availability: null,
                  booking: null,
                  notes: null,
                }
                const isToday = dateString === formatDate(new Date())
                const isOutsideMonth = date.getMonth() !== currentMonth.getMonth()

                return (
                  <button
                    key={dateString}
                    type="button"
                    onClick={() => handleSelectDay(day)}
                    className={`min-h-[96px] rounded-md border p-2 text-left transition hover:border-primary/80 ${STATUS_STYLES[day.status]} ${isToday ? 'ring-2 ring-primary' : ''} ${isOutsideMonth ? 'opacity-50' : ''}`}
                  >
                    <span className="text-sm font-semibold text-foreground">{date.getDate()}</span>
                    <div className="mt-2 space-y-1">
                      <span className="inline-flex rounded-md bg-background/80 px-2 py-0.5 text-xs font-medium capitalize text-foreground">{day.status}</span>
                      {day.booking ? <p className="truncate text-xs text-muted-foreground">{day.booking.events?.event_name || 'Booking'}</p> : null}
                      {day.notes ? <p className="line-clamp-2 text-xs text-muted-foreground">{day.notes}</p> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedDay ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit {selectedDay.date}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSelectedBookingControlled ? (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                This date is controlled by a {selectedDay.booking?.status || 'linked'} booking. Booking-controlled dates cannot be manually cleared.
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Status</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as VendorAvailabilityStatus)}
                  disabled={isSelectedBookingControlled}
                  className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="available">Available</option>
                  <option value="blocked">Blocked</option>
                  <option value="tentative">Tentative</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Notes</label>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm"
                  placeholder="Reason for block or tentative hold"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectedDay(null)}>Cancel</Button>
              <Button onClick={handleSaveStatus} disabled={saving || isSelectedBookingControlled}>
                {saving ? 'Saving...' : <><Save className="mr-2 h-4 w-4" />Save Date</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

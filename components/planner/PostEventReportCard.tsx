'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Plan } from '@/lib/types'
import { cn } from '@/lib/utils'

type EventReportStatus = {
  eligible: boolean
  event_has_passed: boolean
  event_name: string
  event_date: string | null
  pending_agreements: Array<{
    id: string
    venue_id: string | null
    venue_name: string
  }>
}

type EventReportSubmission = {
  extracted_value: number | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  agreement_id: string | null
  final_attendance: number | null
}

interface PostEventReportCardProps {
  plan: Plan | null
  className?: string
}

const acceptedFileTypes = [
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/pdf',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  '.csv',
  '.xlsx',
  '.xls',
  '.pdf',
].join(',')

export function PostEventReportCard({ plan, className }: PostEventReportCardProps) {
  const [status, setStatus] = useState<EventReportStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [manualAttendance, setManualAttendance] = useState('')
  const [submission, setSubmission] = useState<EventReportSubmission | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shouldCheckReport = useMemo(() => {
    if (!plan?.id || !plan.date_window_start) return false
    const eventDate = new Date(plan.date_window_start)
    return !Number.isNaN(eventDate.getTime()) && eventDate.getTime() < Date.now()
  }, [plan?.date_window_start, plan?.id])

  useEffect(() => {
    if (!plan?.id || !shouldCheckReport) {
      setStatus(null)
      return
    }

    const planId = plan.id
    let cancelled = false

    async function loadStatus() {
      setIsLoadingStatus(true)
      setError(null)

      try {
        const response = await fetch(`/api/planner/plans/${planId}/event-report`, {
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error ?? 'Unable to load event report status')
        if (!cancelled) setStatus(payload as EventReportStatus)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load event report status')
        }
      } finally {
        if (!cancelled) setIsLoadingStatus(false)
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [plan?.id, shouldCheckReport])

  if (!plan || !shouldCheckReport) return null
  if (!isLoadingStatus && status && !status.eligible && !isConfirmed) return null

  const venueNames = status?.pending_agreements.map((agreement) => agreement.venue_name).filter(Boolean) ?? []
  const venueLabel = venueNames.length > 0 ? venueNames.join(', ') : 'the venue'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan?.id || isSubmitting) return

    const attendanceValue = manualAttendance.trim()
    if (!selectedFile && !attendanceValue) {
      setError('Upload a report or enter the verified attendance count.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSubmission(null)
    setIsConfirmed(false)

    try {
      const formData = new FormData()
      if (selectedFile) formData.set('image', selectedFile)
      if (attendanceValue) formData.set('actual_attendance_override', attendanceValue)

      const response = await fetch(`/api/planner/plans/${plan.id}/event-report`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to submit attendance')

      const nextSubmission = payload as EventReportSubmission
      setSubmission(nextSubmission)
      if (nextSubmission.final_attendance !== null) {
        setManualAttendance(String(nextSubmission.final_attendance))
      }
      setSelectedFile(null)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit attendance')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleConfirm() {
    setIsConfirmed(true)
    setStatus((current) => current ? { ...current, eligible: false, pending_agreements: [] } : current)
  }

  return (
    <section className={cn('rounded-3xl border border-border bg-gradient-card p-5 shadow-card', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Post-event report</p>
          <h3 className="mt-2 font-display text-xl font-bold text-foreground">
            How did {status?.event_name ?? plan.title ?? 'this event'} go?
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Submit verified attendance so {venueLabel} can complete the revenue report and settlement flow.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">
          <FileText className="h-3.5 w-3.5" />
          Attendance needed
        </span>
      </div>

      {isConfirmed ? (
        <div className="mt-5 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-4 w-4" />
            Attendance submitted
          </div>
          <p className="mt-2 text-success/90">
            Thanks. The venue revenue report can now use this attendance record.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/50 px-4 py-5 text-center transition-smooth hover:border-primary/50">
            <UploadCloud className="h-8 w-8 text-primary" />
            <span className="mt-3 text-sm font-bold text-foreground">
              {selectedFile ? selectedFile.name : 'Upload attendance report'}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">Screenshot, PDF, CSV, or Excel</span>
            <input
              type="file"
              accept={acceptedFileTypes}
              className="sr-only"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <div className="rounded-2xl border border-border bg-background/50 p-4">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground" htmlFor="post-event-attendance">
              Verified attendance
            </label>
            <Input
              id="post-event-attendance"
              className="mt-2"
              inputMode="numeric"
              min={0}
              type="number"
              value={manualAttendance}
              onChange={(event) => setManualAttendance(event.target.value)}
              placeholder="Enter headcount"
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Manual value wins if it differs from the extracted file value.
            </p>
            <Button type="submit" variant="hero" className="mt-4 w-full" disabled={isSubmitting || isLoadingStatus}>
              {isSubmitting || isLoadingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Submit attendance
            </Button>
          </div>
        </form>
      )}

      {submission ? (
        <div className="mt-4 rounded-2xl border border-border bg-background/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">
                {submission.final_attendance !== null
                  ? `${submission.final_attendance.toLocaleString()} attendees recorded`
                  : 'Extraction needs review'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Confidence: {submission.confidence}. {submission.reasoning}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="glass" size="sm" onClick={() => setSubmission(null)}>
                Edit
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                onClick={handleConfirm}
                disabled={submission.final_attendance === null}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  )
}

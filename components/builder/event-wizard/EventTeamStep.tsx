'use client'

import { useEffect, useState } from 'react'
import { X, UserPlus, Mail, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { Event, EventTeamMember } from '@/lib/types'

interface EventTeamStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

type TeamRole = EventTeamMember['role']

const selectCls = `
  flex h-11 w-full rounded-xl border border-border bg-card/40
  px-4 py-3 text-base text-foreground min-h-[44px]
  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
  transition-smooth hover:border-border/80 hover:bg-card
  appearance-none
  bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23a1a1aa%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]
  bg-no-repeat bg-right-4 bg-[length:18px]
`

export function EventTeamStep({ event }: EventTeamStepProps) {
  const { addToast } = useToast()
  const [teamMembers, setTeamMembers] = useState<EventTeamMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<TeamRole>('coordinator')
  const [isSending, setIsSending] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)

  useEffect(() => {
    if (!event.id || event.id === 'new') return

    let isCancelled = false

    async function fetchTeamMembers() {
      try {
        const response = await fetch(`/api/builder/events/${event.id}/team`, {
          credentials: 'include',
        })
        const result = await response.json() as { members?: EventTeamMember[]; error?: string }

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load team members')
        }

        if (!isCancelled) {
          setTeamMembers(result.members || [])
        }
      } catch (error) {
        if (!isCancelled) {
          addToast({
            title: 'Error',
            description: error instanceof Error ? error.message : 'Failed to load team members',
            variant: 'destructive',
          })
        }
      }
    }

    fetchTeamMembers()

    return () => {
      isCancelled = true
    }
  }, [event.id, addToast])

  const handleSendInvite = async () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      addToast({ title: 'Invalid email', description: 'Please enter a valid email address', variant: 'destructive' })
      return
    }
    if (teamMembers.some((m) => m.email.toLowerCase() === inviteEmail.toLowerCase())) {
      addToast({ title: 'Already invited', description: 'This email has already been invited', variant: 'destructive' })
      return
    }
    setIsSending(true)
    const email = inviteEmail.trim().toLowerCase()
    try {
      const response = await fetch(`/api/builder/events/${event.id}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, role: inviteRole }),
      })
      const result = await response.json() as { member?: EventTeamMember; error?: string }

      if (!response.ok || !result.member) {
        throw new Error(result.error || 'Failed to send invitation')
      }

      setTeamMembers((members) => [...members, result.member as EventTeamMember])
      setInviteEmail('')
      addToast({ title: 'Invitation sent', description: `Invitation email sent to ${email}` })
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send invitation. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    const member = teamMembers.find((m) => m.id === memberId)
    setRemovingMemberId(memberId)
    try {
      const response = await fetch(`/api/builder/events/${event.id}/team?memberId=${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const result = await response.json() as { error?: string }

      if (!response.ok) {
        throw new Error(result.error || 'Failed to remove team member')
      }

      setTeamMembers((members) => members.filter((m) => m.id !== memberId))
      addToast({ title: 'Removed', description: member ? `${member.email} removed from team` : 'Team member removed' })
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove team member',
        variant: 'destructive',
      })
    } finally {
      setRemovingMemberId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <div className="rounded-xl border border-border bg-sidebar-accent/40 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-display text-lg font-bold text-foreground">Send Invitation</h3>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input
              type="email"
              placeholder="team@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendInvite() } }}
              className="min-h-[44px]"
            />
          </div>
          <div className="w-full sm:w-48">
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              className={selectCls}
              aria-label="Team member role"
            >
              <option value="organizer">Organizer</option>
              <option value="coordinator">Coordinator</option>
              <option value="vendor_contact">Vendor Contact</option>
            </select>
          </div>
          <Button type="button" variant="hero" onClick={handleSendInvite} disabled={isSending || !inviteEmail} className="min-h-[44px]">
            {isSending ? 'Sending...' : 'Send Invite'}
          </Button>
        </div>
      </div>

      {/* Team list */}
      {teamMembers.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-display text-lg font-bold text-foreground">
              Invited Members ({teamMembers.length})
            </h3>
          </div>
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card/40 p-4 transition-smooth hover:border-primary/40 hover:bg-card"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <UserPlus className="h-4 w-4 text-muted-foreground/60" />
                  <p className="text-sm font-semibold text-foreground">{member.email}</p>
                </div>
                <p className="ml-6 text-xs capitalize text-muted-foreground">{member.role.replace('_', ' ')}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveMember(member.id)}
                disabled={removingMemberId === member.id}
                className="min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${member.email}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-sidebar-accent/20 py-16 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-sidebar-accent">
            <Users className="h-10 w-10 text-muted-foreground/60" />
          </div>
          <h3 className="font-display text-xl font-bold text-foreground">No team members yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">Invite collaborators to help plan and coordinate your event</p>
        </div>
      )}
    </div>
  )
}

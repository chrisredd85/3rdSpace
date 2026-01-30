'use client'

import { useState } from 'react'
import { X, UserPlus, Mail, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { Event } from '@/lib/types'

interface EventTeamStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

interface TeamMember {
  id: string
  email: string
  role: 'organizer' | 'coordinator' | 'vendor_contact'
}

export function EventTeamStep({
  event,
  onNext,
  onPrevious,
}: EventTeamStepProps) {
  const { addToast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'organizer' | 'coordinator' | 'vendor_contact'>('coordinator')
  const [isSending, setIsSending] = useState(false)

  const handleSendInvite = async () => {
    // Validate email
    if (!inviteEmail || !inviteEmail.includes('@')) {
      addToast({
        title: 'Invalid email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      })
      return
    }

    // Check if email is already invited
    if (teamMembers.some((m) => m.email.toLowerCase() === inviteEmail.toLowerCase())) {
      addToast({
        title: 'Already invited',
        description: 'This email has already been invited',
        variant: 'destructive',
      })
      return
    }

    setIsSending(true)

    try {
      // TODO: Call API route to send invitation email
      // For now, just add to local state
      const newMember: TeamMember = {
        id: Date.now().toString(),
        email: inviteEmail,
        role: inviteRole,
      }

      setTeamMembers([...teamMembers, newMember])
      setInviteEmail('')
      
      addToast({
        title: 'Invitation sent',
        description: `Invitation email sent to ${inviteEmail}`,
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to send invitation. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleRemoveMember = (memberId: string) => {
    const member = teamMembers.find((m) => m.id === memberId)
    setTeamMembers(teamMembers.filter((m) => m.id !== memberId))
    addToast({
      title: 'Removed',
      description: member ? `${member.email} removed from team` : 'Team member removed',
    })
  }

  const handleContinue = () => {
    // Team step is optional, so we can always continue
    onNext()
  }

  return (
    <div className="space-y-6">
          {/* Invite Form */}
          <div className="border-2 border-slate-200 rounded-xl p-6 bg-slate-50">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-forest-100 rounded-lg">
                <Mail className="h-5 w-5 text-forest-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Send Invitation</h3>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Input
                  type="email"
                  placeholder="team@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSendInvite()
                    }
                  }}
                  className="min-h-[44px]"
                />
              </div>
              <div className="w-full sm:w-48">
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'organizer' | 'coordinator' | 'vendor_contact')}
                  className="
                    flex h-11 w-full rounded-xl border-2 border-slate-200 
                    px-4 py-3 text-base text-slate-900 min-h-[44px]
                    focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
                    transition-all duration-200 hover:border-slate-300
                    appearance-none
                    bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23334155%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]
                    bg-no-repeat bg-right-4 bg-[length:20px]
                  "
                  aria-label="Team member role"
                >
                  <option value="organizer">Organizer</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="vendor_contact">Vendor Contact</option>
                </select>
              </div>
              <Button
                type="button"
                onClick={handleSendInvite}
                disabled={isSending || !inviteEmail}
                className="min-h-[44px]"
              >
                {isSending ? 'Sending...' : 'Send Invite'}
              </Button>
            </div>
          </div>

          {/* Team Members List */}
          {teamMembers.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-forest-100 rounded-lg">
                  <Users className="h-5 w-5 text-forest-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Invited Team Members ({teamMembers.length})
                </h3>
              </div>
              <div className="space-y-3">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 bg-white rounded-xl border-2 border-slate-200 hover:border-forest-500 transition-all duration-200 hover:shadow-md"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <UserPlus className="h-4 w-4 text-slate-400" />
                        <p className="text-sm font-semibold text-slate-900">{member.email}</p>
                      </div>
                      <p className="text-xs text-slate-500 capitalize ml-6">
                        {member.role.replace('_', ' ')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveMember(member.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[44px] min-w-[44px]"
                      aria-label={`Remove ${member.email}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 border-2 border-slate-200 rounded-xl bg-slate-50">
              <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
                <Users className="w-10 h-10 text-slate-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">No team members invited yet</h3>
              <p className="text-slate-600">
                Invite collaborators to help plan and coordinate your event
              </p>
            </div>
          )}
    </div>
  )
}

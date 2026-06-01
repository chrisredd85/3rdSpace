'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { VenueRuleAudience, VenueRuleType } from '@/lib/types'

export interface VenueRuleFormValue {
  id?: string
  title: string
  description: string
  rule_type: VenueRuleType
  applies_to: VenueRuleAudience
  is_mandatory: boolean
}

interface RulesManagerProps {
  venueId: string
  onSave?: (rules: VenueRuleFormValue[]) => void
}

const RULE_TYPE_OPTIONS: Array<{ value: VenueRuleType; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'safety', label: 'Safety' },
  { value: 'conduct', label: 'Conduct' },
]

const AUDIENCE_OPTIONS: Array<{ value: VenueRuleAudience; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'vendors', label: 'Vendors Only' },
  { value: 'organizations', label: 'Organizations Only' },
  { value: 'builders', label: 'Builders Only' },
]

/**
 * Returns starter rules that help venue owners configure a useful baseline.
 *
 * @returns Default rules including insurance and common house rules.
 */
function getDefaultRules(): VenueRuleFormValue[] {
  return [
    {
      title: 'Liability Insurance Required',
      description: 'Event organizers and vendors must provide proof of general liability insurance before the event.',
      rule_type: 'insurance',
      applies_to: 'all',
      is_mandatory: true,
    },
    {
      title: 'No Smoking Indoors',
      description: 'Smoking is only permitted in designated outdoor areas.',
      rule_type: 'conduct',
      applies_to: 'all',
      is_mandatory: true,
    },
    {
      title: 'Respect Noise Ordinances',
      description: 'Amplified sound must follow local noise rules and venue quiet hours.',
      rule_type: 'conduct',
      applies_to: 'all',
      is_mandatory: true,
    },
    {
      title: 'Leave Venue as Found',
      description: 'All decorations, equipment, and trash must be removed during load-out.',
      rule_type: 'general',
      applies_to: 'all',
      is_mandatory: true,
    },
  ]
}

/**
 * Checks whether a rule is complete enough to save.
 *
 * @param rule - Rule form value.
 * @returns Validation error string, or null when valid.
 */
function validateRule(rule: VenueRuleFormValue) {
  if (!rule.title.trim()) return 'Every rule needs a title.'
  if (!rule.description.trim()) return 'Every rule needs a description.'
  return null
}

/**
 * Manages a venue owner's structured house rules and insurance requirements.
 *
 * @param props - Venue id plus optional save callback.
 * @returns Editable rule management UI.
 */
export function RulesManager({ venueId, onSave }: RulesManagerProps) {
  const { addToast } = useToast()
  const [rules, setRules] = useState<VenueRuleFormValue[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * Loads persisted rules for this venue, falling back to defaults for empty venues.
   */
  async function loadRules() {
    setLoading(true)
    try {
      const response = await fetch(`/api/venue/rules?venueId=${venueId}`, {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load rules')
      }

      const loadedRules = (data.rules || []) as VenueRuleFormValue[]
      setRules(loadedRules.length > 0 ? loadedRules : getDefaultRules())
    } catch (error) {
      console.error('[RulesManager] Error loading rules', error)
      setRules(getDefaultRules())
      addToast({
        title: 'Could not load rules',
        description: error instanceof Error ? error.message : 'Using starter rules for now.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRules()
  }, [venueId])

  /**
   * Saves all current rules as a bulk replacement.
   */
  async function handleSave() {
    const firstError = rules.map(validateRule).find(Boolean)
    if (firstError) {
      addToast({
        title: 'Rules need attention',
        description: firstError,
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/venue/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ venueId, rules }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save rules')
      }

      setRules((data.rules || []) as VenueRuleFormValue[])
      onSave?.((data.rules || []) as VenueRuleFormValue[])
      addToast({
        title: 'Rules saved',
        description: 'Your house rules and insurance requirements are ready for booking requests.',
      })
    } catch (error) {
      console.error('[RulesManager] Error saving rules', error)
      addToast({
        title: 'Could not save rules',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Adds a blank rule to the bottom of the list.
   */
  function addRule() {
    setRules([
      ...rules,
      {
        title: '',
        description: '',
        rule_type: 'general',
        applies_to: 'all',
        is_mandatory: false,
      },
    ])
  }

  /**
   * Updates a rule at a specific index.
   *
   * @param index - Rule index to update.
   * @param updates - Partial rule fields to merge.
   */
  function updateRule(index: number, updates: Partial<VenueRuleFormValue>) {
    const nextRules = [...rules]
    nextRules[index] = { ...nextRules[index], ...updates }
    setRules(nextRules)
  }

  /**
   * Removes a rule from the list.
   *
   * @param index - Rule index to delete.
   */
  function deleteRule(index: number) {
    setRules(rules.filter((_, ruleIndex) => ruleIndex !== index))
  }

  /**
   * Moves a rule up or down to control booking-flow display order.
   *
   * @param index - Current rule index.
   * @param direction - Direction to move the rule.
   */
  function moveRule(index: number, direction: 'up' | 'down') {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === rules.length - 1) return

    const nextRules = [...rules]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    ;[nextRules[index], nextRules[targetIndex]] = [nextRules[targetIndex], nextRules[index]]
    setRules(nextRules)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-tan bg-cream p-4 text-sm text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading venue rules...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold text-ink">House Rules</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Mandatory rules require organizer acceptance before booking.
          </p>
        </div>
        <Button type="button" onClick={addRule} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      <div className="space-y-4">
        {rules.map((rule, index) => (
          <div key={rule.id ?? index} className="rounded-lg border-2 border-tan bg-cream/40 p-4">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => moveRule(index, 'up')}
                  disabled={index === 0}
                  className="rounded-lg p-1 text-ink-soft/60 hover:bg-cream-deep/40 hover:text-ink-soft disabled:opacity-30"
                  aria-label="Move rule up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveRule(index, 'down')}
                  disabled={index === rules.length - 1}
                  className="rounded-lg p-1 text-ink-soft/60 hover:bg-cream-deep/40 hover:text-ink-soft disabled:opacity-30"
                  aria-label="Move rule down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-3">
                <input
                  type="text"
                  value={rule.title}
                  onChange={(event) => updateRule(index, { title: event.target.value })}
                  placeholder="Rule title"
                  className="w-full rounded-lg border-2 border-tan px-3 py-2 font-semibold text-ink focus:border-clay focus:outline-none"
                />

                <textarea
                  value={rule.description}
                  onChange={(event) => updateRule(index, { description: event.target.value })}
                  placeholder="Detailed description of the rule"
                  rows={3}
                  className="w-full rounded-lg border-2 border-tan px-3 py-2 text-sm text-ink focus:border-clay focus:outline-none"
                />

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-ink-soft">Type</label>
                    <select
                      value={rule.rule_type}
                      onChange={(event) => updateRule(index, { rule_type: event.target.value as VenueRuleType })}
                      className="h-10 w-full rounded-lg border-2 border-tan px-3 text-sm focus:border-clay focus:outline-none"
                    >
                      {RULE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-ink-soft">Applies To</label>
                    <select
                      value={rule.applies_to}
                      onChange={(event) => updateRule(index, { applies_to: event.target.value as VenueRuleAudience })}
                      className="h-10 w-full rounded-lg border-2 border-tan px-3 text-sm focus:border-clay focus:outline-none"
                    >
                      {AUDIENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 rounded-lg border-2 border-tan px-3 py-2 text-sm font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={rule.is_mandatory}
                      onChange={(event) => updateRule(index, { is_mandatory: event.target.checked })}
                      className="h-4 w-4 text-clay"
                    />
                    Mandatory
                  </label>
                </div>

                {rule.rule_type === 'insurance' ? (
                  <div className="flex items-start gap-2 rounded-lg border border-ochre/30 bg-ochre-tint p-3 text-sm text-ochre">
                    <ShieldCheck className="mt-0.5 h-4 w-4" />
                    Insurance rules are highlighted during booking so organizers and vendors can prepare coverage documents.
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => deleteRule(index)}
                className="h-10 rounded-lg p-2 text-brick hover:bg-brick/10 hover:text-brick"
                aria-label="Delete rule"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {rules.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-tan bg-cream p-6 text-sm text-ink-soft">
          <AlertCircle className="h-4 w-4" />
          No rules yet. Add your first rule to get started.
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" onClick={loadRules} variant="outline" disabled={saving}>
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Rules
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import type { VenueRule, VenueRuleAudience, VenueRuleType } from '@/lib/types'

type GroupedRules = Record<VenueRuleType, VenueRule[]>

interface VenueRulesDisplayProps {
  venueId: string
  audience?: VenueRuleAudience
  onAccept?: (accepted: boolean) => void
}

const CATEGORY_LABELS: Record<VenueRuleType, string> = {
  insurance: 'Insurance Requirements',
  safety: 'Safety Rules',
  conduct: 'Conduct Rules',
  general: 'General Rules',
}

/**
 * Returns whether a rule applies to the active booking audience.
 *
 * @param rule - Venue rule returned by the API.
 * @param audience - Current actor/audience in the booking flow.
 * @returns True when the rule should be shown.
 */
function ruleAppliesToAudience(rule: VenueRule, audience: VenueRuleAudience) {
  return rule.applies_to === 'all' || rule.applies_to === audience
}

/**
 * Groups rules by category while preserving API order inside each category.
 *
 * @param rules - Flat venue rules.
 * @param audience - Current actor/audience in the booking flow.
 * @returns Rules keyed by rule type.
 */
function groupRules(rules: VenueRule[], audience: VenueRuleAudience): GroupedRules {
  const grouped: GroupedRules = {
    general: [],
    insurance: [],
    safety: [],
    conduct: [],
  }

  rules
    .filter((rule) => ruleAppliesToAudience(rule, audience))
    .forEach((rule) => {
      grouped[rule.rule_type].push(rule)
    })

  return grouped
}

/**
 * Displays venue rules in the builder booking flow.
 *
 * Mandatory rules require a checkbox acceptance before the parent form can
 * submit. Insurance rules are highlighted separately so organizers can prepare
 * COI or event insurance documentation early.
 *
 * @param props - Venue id, optional audience filter, and acceptance callback.
 * @returns Venue rule display and mandatory acceptance control.
 */
export function VenueRulesDisplay({
  venueId,
  audience = 'builders',
  onAccept,
}: VenueRulesDisplayProps) {
  const [rules, setRules] = useState<VenueRule[]>([])
  const [acceptedMandatory, setAcceptedMandatory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads rules for the selected venue.
     */
    async function loadRules() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/venue/rules?venueId=${venueId}`, {
          credentials: 'include',
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load venue rules')
        }

        if (isMounted) {
          setRules((data.rules || []) as VenueRule[])
        }
      } catch (loadError) {
        console.error('[VenueRulesDisplay] Failed to load rules', loadError)
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load venue rules')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadRules()

    return () => {
      isMounted = false
    }
  }, [venueId])

  const visibleRules = useMemo(
    () => rules.filter((rule) => ruleAppliesToAudience(rule, audience)),
    [rules, audience]
  )
  const grouped = useMemo(() => groupRules(rules, audience), [rules, audience])
  const hasMandatoryRules = visibleRules.some((rule) => rule.is_mandatory)
  const isAccepted = !hasMandatoryRules || acceptedMandatory

  useEffect(() => {
    onAccept?.(isAccepted)
  }, [isAccepted, onAccept])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading venue rules...
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (visibleRules.length === 0) {
    return null
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card/40 p-5">
      <div>
        <h3 className="text-lg font-bold text-foreground">Venue Rules & Requirements</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Review the venue requirements before submitting your booking request.
        </p>
      </div>

      {grouped.insurance.length > 0 ? (
        <div className="rounded-xl border-2 border-yellow-500/30 bg-yellow-500/10 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-bold text-yellow-200">
            <ShieldAlert className="h-5 w-5" />
            Insurance Requirements
          </h4>
          <ul className="space-y-3">
            {grouped.insurance.map((rule) => (
              <li key={rule.id} className="flex gap-2 text-sm">
                {rule.is_mandatory ? <span className="font-bold text-destructive">*</span> : null}
                <div>
                  <p className="font-semibold text-foreground">{rule.title}</p>
                  <p className="mt-1 text-foreground">{rule.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Applies to: {rule.applies_to === 'all' ? 'everyone' : rule.applies_to}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(['safety', 'conduct', 'general'] as VenueRuleType[]).map((category) =>
        grouped[category].length > 0 ? (
          <div key={category} className="space-y-3">
            <h4 className="font-bold text-foreground">{CATEGORY_LABELS[category]}</h4>
            <ul className="space-y-3">
              {grouped[category].map((rule) => (
                <li key={rule.id} className="flex gap-2 text-sm">
                  {rule.is_mandatory ? <span className="font-bold text-destructive">*</span> : null}
                  <div>
                    <p className="font-semibold text-foreground">{rule.title}</p>
                    <p className="mt-1 text-muted-foreground">{rule.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      )}

      {hasMandatoryRules ? (
        <div className="rounded-xl border-2 border-border bg-background p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acceptedMandatory}
              onChange={(event) => setAcceptedMandatory(event.target.checked)}
              className="mt-1 h-5 w-5 rounded border-border text-primary"
            />
            <div>
              <p className="font-semibold text-foreground">I agree to follow all mandatory venue rules</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Rules marked with * must be accepted before requesting this venue.
              </p>
            </div>
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          No mandatory rule acceptance required.
        </div>
      )}

      {hasMandatoryRules && !acceptedMandatory ? (
        <div className="flex items-center gap-2 text-sm text-yellow-300">
          <AlertCircle className="h-4 w-4" />
          Accept mandatory rules to continue.
        </div>
      ) : null}
    </div>
  )
}

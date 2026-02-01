'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Plus, X, FileText, Shield, ListChecks } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import type { VenueRequirement } from '@/lib/types'

export default function VenueRequirementsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const router = useRouter()
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: venue, isLoading } = useVenue(venueId)

  // Required documents state
  const [requiredDocuments, setRequiredDocuments] = useState({
    coi: false,
    contract: false,
    license: false,
    id: false,
  })

  // Insurance requirements state
  const [insuranceMinCoverage, setInsuranceMinCoverage] = useState('')
  const [insuranceAdditionalInsured, setInsuranceAdditionalInsured] = useState('')

  // Venue rules state
  const [venueRules, setVenueRules] = useState('')

  // Custom questions state
  const [customQuestions, setCustomQuestions] = useState<string[]>([''])

  useEffect(() => {
    if (user) {
      supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: venues }: { data: { id: string }[] | null }) => {
          if (venues && venues.length > 0) {
            setVenueId(venues[0].id)
          }
        })
    }
  }, [user])

  // Load existing requirements
  useEffect(() => {
    if (venueId) {
      supabase
        .from('venue_requirements')
        .select('*')
        .eq('venue_id', venueId)
        .then(({ data: requirements }: { data: { requirement_type: string; requirement_description: string | null }[] | null }) => {
          if (requirements) {
            type ReqRow = { requirement_type: string; requirement_description: string | null }
            // Load required documents
            requirements.forEach((req: ReqRow) => {
              if (req.requirement_type === 'coi') {
                setRequiredDocuments((prev) => ({ ...prev, coi: true }))
              } else if (req.requirement_type === 'contract') {
                setRequiredDocuments((prev) => ({ ...prev, contract: true }))
              } else if (req.requirement_type === 'license') {
                setRequiredDocuments((prev) => ({ ...prev, license: true }))
              } else if (req.requirement_type === 'id') {
                setRequiredDocuments((prev) => ({ ...prev, id: true }))
              }
            })

            // Load insurance requirements
            const insuranceReq = requirements.find((r: ReqRow) => r.requirement_type === 'insurance')
            if (insuranceReq) {
              setInsuranceMinCoverage(insuranceReq.requirement_description || '')
            }

            // Load venue rules
            const rulesReq = requirements.find((r: ReqRow) => r.requirement_type === 'rules')
            if (rulesReq) {
              setVenueRules(rulesReq.requirement_description || '')
            }

            // Load custom questions
            const questionReqs = requirements.filter((r: ReqRow) => r.requirement_type === 'question')
            if (questionReqs.length > 0) {
              setCustomQuestions(questionReqs.map((r: ReqRow) => r.requirement_description || ''))
            }
          }
        })
    }
  }, [venueId])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Please log in to continue</div>
      </div>
    )
  }

  const handleSave = async () => {
    if (!venueId) return

    setIsSaving(true)
    try {
      // Delete existing requirements
      await supabase.from('venue_requirements').delete().eq('venue_id', venueId)

      // Build requirements array
      const requirementsToInsert: any[] = []

      // Required documents
      if (requiredDocuments.coi) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'coi',
          requirement_description: 'Certificate of Insurance required',
          is_mandatory: true,
        })
      }
      if (requiredDocuments.contract) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'contract',
          requirement_description: 'Signed contract required',
          is_mandatory: true,
        })
      }
      if (requiredDocuments.license) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'license',
          requirement_description: 'Business license required',
          is_mandatory: true,
        })
      }
      if (requiredDocuments.id) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'id',
          requirement_description: 'Valid ID required',
          is_mandatory: true,
        })
      }

      // Insurance requirements
      if (insuranceMinCoverage) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'insurance',
          requirement_description: `Minimum coverage: ${insuranceMinCoverage}`,
          is_mandatory: true,
        })
      }

      if (insuranceAdditionalInsured) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'insurance_additional',
          requirement_description: `Additional insured: ${insuranceAdditionalInsured}`,
          is_mandatory: true,
        })
      }

      // Venue rules
      if (venueRules) {
        requirementsToInsert.push({
          venue_id: venueId,
          requirement_type: 'rules',
          requirement_description: venueRules,
          is_mandatory: true,
        })
      }

      // Custom questions
      customQuestions
        .filter((q) => q.trim())
        .forEach((question) => {
          requirementsToInsert.push({
            venue_id: venueId,
            requirement_type: 'question',
            requirement_description: question,
            is_mandatory: false,
          })
        })

      // Insert all requirements
      if (requirementsToInsert.length > 0) {
        await supabase.from('venue_requirements').insert(requirementsToInsert)
      }

      addToast({
        title: 'Requirements saved',
        description: 'Your venue requirements have been updated successfully.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to save requirements',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const addQuestion = () => {
    setCustomQuestions([...customQuestions, ''])
  }

  const removeQuestion = (index: number) => {
    setCustomQuestions(customQuestions.filter((_, i) => i !== index))
  }

  const updateQuestion = (index: number, value: string) => {
    const updated = [...customQuestions]
    updated[index] = value
    setCustomQuestions(updated)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading requirements...</p>
        </div>
      </div>
    )
  }

  if (!venue) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No venue found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Requirements</h1>
        <p className="text-gray-600 mt-1">Set requirements and rules for event organizers</p>
      </div>

      {/* Required Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Required Documents
          </CardTitle>
          <CardDescription>
            Select which documents organizers must provide
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { key: 'coi', label: 'Certificate of Insurance (COI)' },
              { key: 'contract', label: 'Signed Contract' },
              { key: 'license', label: 'Business License' },
              { key: 'id', label: 'Valid ID' },
            ].map((doc) => (
              <label
                key={doc.key}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={requiredDocuments[doc.key as keyof typeof requiredDocuments]}
                  onChange={(e) =>
                    setRequiredDocuments({
                      ...requiredDocuments,
                      [doc.key]: e.target.checked,
                    })
                  }
                  className="h-4 w-4 text-forest-500 focus:ring-forest-500"
                />
                <span className="text-sm font-medium text-gray-900">{doc.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Insurance Requirements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Insurance Requirements
          </CardTitle>
          <CardDescription>
            Specify insurance coverage requirements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Minimum Coverage Amount
            </label>
            <Input
              value={insuranceMinCoverage}
              onChange={(e) => setInsuranceMinCoverage(e.target.value)}
              placeholder="e.g., $1,000,000"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Additional Insured
            </label>
            <Input
              value={insuranceAdditionalInsured}
              onChange={(e) => setInsuranceAdditionalInsured(e.target.value)}
              placeholder="e.g., Venue Name, LLC"
            />
          </div>
        </CardContent>
      </Card>

      {/* Venue Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Venue Rules
          </CardTitle>
          <CardDescription>
            Set rules and guidelines for events at your venue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={venueRules}
            onChange={(e) => setVenueRules(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
            placeholder="Enter venue rules and guidelines..."
          />
        </CardContent>
      </Card>

      {/* Custom Intake Questions */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Intake Questions</CardTitle>
          <CardDescription>
            Add custom questions for event organizers to answer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {customQuestions.map((question, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={question}
                onChange={(e) => updateQuestion(index, e.target.value)}
                placeholder="Enter a question..."
                className="flex-1"
              />
              {customQuestions.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeQuestion(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={addQuestion}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Question
          </Button>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            'Saving...'
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Requirements
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

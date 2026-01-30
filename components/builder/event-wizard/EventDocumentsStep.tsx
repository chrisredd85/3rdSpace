'use client'

import { useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Event } from '@/lib/types'

interface EventDocumentsStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

export function EventDocumentsStep({
  onNext,
}: EventDocumentsStepProps) {
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; file: File }>>([])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      setDocuments([
        ...documents,
        { id: Date.now().toString(), name: file.name, file },
      ])
    })
  }

  const handleRemoveDocument = (id: string) => {
    setDocuments(documents.filter((d) => d.id !== id))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Step 7: Documents</CardTitle>
          <CardDescription>
            Upload insurance certificates, contracts, and other required documents
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" asChild>
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Documents
                </span>
              </Button>
            </label>
          </div>

          {documents.length > 0 && (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg"
                >
                  <FileText className="h-5 w-5 text-gray-400" />
                  <span className="flex-1 text-sm text-gray-900">{doc.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveDocument(doc.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Button onClick={onNext}>Next: Finalize</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

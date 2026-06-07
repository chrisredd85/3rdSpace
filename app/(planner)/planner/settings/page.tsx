'use client'

import Link from 'next/link'
import { ExternalLink, Mail } from 'lucide-react'
import { AccountSettingsClient } from '@/components/settings/AccountSettingsClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Account settings page for the planner shell.
 * Reuses the existing AccountSettingsClient with the builder role.
 */
export default function PlannerSettingsPage() {
  return (
    <div className="space-y-6">
      <AccountSettingsClient role="builder" />

      <Card className="border-border/70 bg-card shadow-sm">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="font-display text-xl font-semibold">Gmail outreach</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect Gmail so 3rdPlace can send approved outreach drafts and read partner replies.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/planner/settings/integrations">
              Manage integrations
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

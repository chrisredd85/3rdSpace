'use client'

import { AccountSettingsClient } from '@/components/settings/AccountSettingsClient'

/**
 * Account settings page for the planner shell.
 * Reuses the existing AccountSettingsClient with the builder role.
 */
export default function PlannerSettingsPage() {
  return <AccountSettingsClient role="builder" />
}

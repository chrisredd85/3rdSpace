/**
 * Purpose: Defines the primary three-panel shell for the `/planner` route.
 * Props: Receives Next.js route children and places them between the fixed sidebar and
 * right-side Live Plan artifact panel.
 * Key behaviors: Delegates planner chrome to the client shell so the side panels
 * can slide open and closed without remounting route content.
 */
import type { ReactNode } from 'react'
import { PlannerShell } from '@/components/planner/PlannerShell'

interface PlannerLayoutProps {
  children: ReactNode
}

/**
 * Three-panel layout for the Agent Planner experience.
 */
export default function PlannerLayout({ children }: PlannerLayoutProps) {
  return <PlannerShell>{children}</PlannerShell>
}

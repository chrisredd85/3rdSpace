import type { ReactNode } from 'react'
import { PlannerResponsiveLayout } from '@/components/planner/mobile/PlannerResponsiveLayout'

export default function PlannerLayout({ children }: { children: ReactNode }) {
  return <PlannerResponsiveLayout>{children}</PlannerResponsiveLayout>
}

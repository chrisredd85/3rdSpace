import type { ReactNode } from 'react'
import { Header } from '@/components/marketing/Header'

interface MarketingLayoutProps {
  children: ReactNode
}

export default function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <>
      <Header />
      {children}
    </>
  )
}

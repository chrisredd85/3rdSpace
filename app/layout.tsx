import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter",
})

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover' as const,
}

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://3rdspace.com'),
  title: {
    default: "3rdPlace · Agent Planner",
    template: "%s | 3rdPlace",
  },
  description: "An agent-like planning workspace for Bay Area event creators to shape plans, compare options, and coordinate bookings.",
  keywords: [
    "event marketplace",
    "venue booking",
    "event vendors",
    "Bay Area events",
    "community events",
    "event planning",
    "venue rental",
    "event services",
  ],
  authors: [{ name: "3rdPlace" }],
  creator: "3rdPlace",
  publisher: "3rdPlace",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://3rdspace.com",
    siteName: "3rdPlace",
    title: "3rdPlace · Agent Planner",
    description: "An agent-like planning workspace for Bay Area event creators.",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "3rdPlace · Agent Planner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "3rdPlace · Agent Planner",
    description: "An agent-like planning workspace for Bay Area event creators.",
    images: ["/og-default.png"],
    creator: "@3rdspace",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add your verification codes here
    // google: "your-google-verification-code",
    // yandex: "your-yandex-verification-code",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://3rdspace.com'

  // Organization structured data
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '3rdPlace',
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description: "An agent-like planning workspace for Bay Area event creators.",
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Service',
      email: 'support@3rdspace.com',
    },
    sameAs: [
      'https://twitter.com/3rdspace',
      'https://linkedin.com/company/3rdspace',
    ],
  }

  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema),
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}

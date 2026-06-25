import type { Metadata } from "next"
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"
import { CookieBanner } from "@/components/marketing/CookieBanner"

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
})

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover' as const,
}

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.3rdplace.io'),
  title: {
    default: "3rdPlace · Agent Planner",
    template: "%s | 3rdPlace",
  },
  description: "An approval-gated event operating workspace for Bay Area hosts to plan, approve, and track profitable events.",
  keywords: [
    "event operating system",
    "approval-gated event planning",
    "event financial planning",
    "Bay Area events",
    "community events",
    "event planning",
    "venue coordination",
    "vendor coordination",
  ],
  authors: [{ name: "3rdPlace" }],
  creator: "3rdPlace",
  publisher: "3rdPlace",
  icons: {
    icon: [
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon-48x48.png"],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://www.3rdplace.io",
    siteName: "3rdPlace",
    title: "3rdPlace · Agent Planner",
    description: "An approval-gated event operating workspace for Bay Area hosts.",
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
    description: "An approval-gated event operating workspace for Bay Area hosts.",
    images: ["/og-default.png"],
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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.3rdplace.io'

  // Organization structured data
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '3rdPlace',
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description: "An approval-gated event operating workspace for Bay Area hosts.",
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Service',
      email: 'hello@3rdplace.io',
    },
  }

  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}>
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
          <Providers>
            {children}
            <CookieBanner />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}

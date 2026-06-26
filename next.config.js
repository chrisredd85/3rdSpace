const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      // Add your Supabase storage domain
      process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '').split('.')[0] + '.supabase.co',
    ].filter(Boolean),
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // Enable compression
  compress: true,
  // Experimental features for better performance
  experimental: {
    optimizeCss: true,
  },
  async redirects() {
    return [
      { source: '/mobile-mockup', destination: '/planner', statusCode: 308 },
      { source: '/mobile-mockup/planner', destination: '/planner', statusCode: 308 },
      { source: '/mobile-mockup/approvals', destination: '/planner/payments', statusCode: 308 },
      { source: '/mobile-mockup/messages', destination: '/planner/messages', statusCode: 308 },
      { source: '/mobile-mockup/vendors', destination: '/planner/vendors', statusCode: 308 },
      { source: '/mobile-mockup/outreach', destination: '/planner/outreach', statusCode: 308 },
      { source: '/mobile-mockup/settings', destination: '/planner/settings', statusCode: 308 },
      { source: '/mobile-mockup/new-plan', destination: '/planner/new-plan', statusCode: 308 },
      { source: '/mobile-mockup/ticketing', destination: '/planner/tickets', statusCode: 308 },
      { source: '/mobile-mockup/analytics', destination: '/planner/analytics', statusCode: 308 },
      { source: '/mobile-mockup/billing', destination: '/planner/billing', statusCode: 308 },
      { source: '/builder', destination: '/planner', statusCode: 301 },
      { source: '/builder/events', destination: '/planner/experiences', statusCode: 301 },
      { source: '/builder/upcoming', destination: '/planner/experiences', statusCode: 301 },
      { source: '/builder/past', destination: '/planner/experiences?filter=archived', statusCode: 301 },
      { source: '/builder/templates', destination: '/planner/templates', statusCode: 301 },
      { source: '/builder/messages', destination: '/planner/messages', statusCode: 301 },
      { source: '/builder/notifications', destination: '/planner', statusCode: 301 },
      { source: '/builder/venues', destination: '/planner/venues', statusCode: 301 },
      { source: '/builder/venues/marketplace', destination: '/planner/venues/marketplace', statusCode: 301 },
      { source: '/builder/venues/:venueId', destination: '/planner/venues/:venueId', statusCode: 301 },
      { source: '/builder/vendors', destination: '/planner/vendors', statusCode: 301 },
      { source: '/builder/vendors/marketplace', destination: '/planner/vendors/marketplace', statusCode: 301 },
      { source: '/builder/vendors/:vendorId', destination: '/planner/vendors/:vendorId', statusCode: 301 },
      { source: '/builder/analytics', destination: '/planner/analytics', statusCode: 301 },
      { source: '/builder/settings', destination: '/planner/settings', statusCode: 301 },
      { source: '/builder/billing', destination: '/planner/billing', statusCode: 301 },
      { source: '/builder/payouts', destination: '/planner/payments', statusCode: 301 },
      { source: '/builder/pricing', destination: '/planner/billing', statusCode: 301 },
      { source: '/builder/event/:path*', destination: '/planner', statusCode: 301 },
      { source: '/builder/:path*', destination: '/planner', statusCode: 301 },
    ]
  },
}

const sentryOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
}

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), sentryOptions)

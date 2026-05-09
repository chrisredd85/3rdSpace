const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

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
  // Optimize production builds
  swcMinify: true,
  // Experimental features for better performance
  experimental: {
    optimizeCss: true,
  },
  async redirects() {
    return [
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

module.exports = withBundleAnalyzer(nextConfig)

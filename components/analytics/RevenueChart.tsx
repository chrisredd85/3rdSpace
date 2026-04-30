'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface RevenueChartProps {
  data: Array<{ month: string; revenue: number | string }>
}

/**
 * Renders monthly vendor revenue as a line chart.
 */
export function RevenueChart({ data }: RevenueChartProps) {
  const formattedData = data.map((item) => ({
    month: formatMonth(item.month),
    revenue: Number(item.revenue || 0),
  }))

  if (formattedData.length === 0) {
    return <EmptyChart label="No revenue data for this period" />
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={formattedData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} tickFormatter={(value) => `$${Number(value).toLocaleString()}`} />
        <Tooltip formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Revenue']} />
        <Line type="monotone" dataKey="revenue" stroke="#047857" strokeWidth={3} dot={{ fill: '#047857', r: 4 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/**
 * Formats an ISO month key into a short label.
 */
function formatMonth(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })
}

/**
 * Renders an empty chart state.
 */
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      {label}
    </div>
  )
}

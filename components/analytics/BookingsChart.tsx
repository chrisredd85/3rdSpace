'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface BookingsChartProps {
  data: Array<{ month: string; bookings: number | string }>
}

/**
 * Renders monthly completed/confirmed booking volume as a bar chart.
 */
export function BookingsChart({ data }: BookingsChartProps) {
  const formattedData = data.map((item) => ({
    month: formatMonth(item.month),
    bookings: Number(item.bookings || 0),
  }))

  if (formattedData.length === 0) {
    return <EmptyChart label="No booking data for this period" />
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={formattedData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="bookings" fill="#2563eb" radius={[8, 8, 0, 0]} />
      </BarChart>
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

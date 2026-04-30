'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface BuilderMonthlySpendingChartProps {
  data: Array<{ month: string; amount: number }>
}

/**
 * Renders builder spending over time as a lazily-loaded Recharts chart.
 */
export function BuilderMonthlySpendingChart({ data }: BuilderMonthlySpendingChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
        <Legend />
        <Bar dataKey="amount" fill="#10B981" name="Spending" />
      </BarChart>
    </ResponsiveContainer>
  )
}

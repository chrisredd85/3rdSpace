'use client'

import * as React from 'react'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive'

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { ...toast, id }])
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: Toast[]
  removeToast: (id: string) => void
}) {
  const getVariantStyles = (variant: ToastVariant = 'default') => {
    switch (variant) {
      case 'success':
        return {
          border: 'border-forest-500',
          bg: 'bg-forest-50',
          icon: CheckCircle,
          iconColor: 'text-forest-600',
        }
      case 'error':
      case 'destructive':
        return {
          border: 'border-red-500',
          bg: 'bg-red-50',
          icon: AlertCircle,
          iconColor: 'text-red-600',
        }
      case 'warning':
        return {
          border: 'border-yellow-500',
          bg: 'bg-yellow-50',
          icon: AlertTriangle,
          iconColor: 'text-yellow-600',
        }
      case 'info':
        return {
          border: 'border-blue-500',
          bg: 'bg-blue-50',
          icon: Info,
          iconColor: 'text-blue-600',
        }
      default:
        return {
          border: 'border-gray-300',
          bg: 'bg-white',
          icon: null,
          iconColor: '',
        }
    }
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm">
      {toasts.map((toast) => {
        const styles = getVariantStyles(toast.variant)
        const Icon = styles.icon

        return (
          <div
            key={toast.id}
            className={cn(
              'rounded-lg border p-4 shadow-lg',
              styles.border,
              styles.bg
            )}
          >
            <div className="flex items-start justify-between gap-3">
              {Icon && (
                <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', styles.iconColor)} />
              )}
              <div className="flex-1 min-w-0">
                {toast.title && (
                  <div
                    className={cn(
                      'font-semibold text-sm',
                      toast.variant === 'error' || toast.variant === 'warning'
                        ? 'text-gray-900'
                        : 'text-gray-900'
                    )}
                  >
                    {toast.title}
                  </div>
                )}
                {toast.description && (
                  <div
                    className={cn(
                      'text-sm mt-1',
                      toast.variant === 'error' || toast.variant === 'warning'
                        ? 'text-gray-700'
                        : 'text-gray-600'
                    )}
                  >
                    {toast.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

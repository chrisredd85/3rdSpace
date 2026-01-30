'use client'

import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface MessageInputProps {
  /**
   * Send message handler
   */
  onSend: (message: string) => void | Promise<void>
  /**
   * Whether input is disabled
   */
  disabled?: boolean
  /**
   * Whether message is being sent
   */
  isSending?: boolean
  /**
   * Placeholder text
   */
  placeholder?: string
  /**
   * Maximum character count
   */
  maxLength?: number
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * MessageInput component for composing and sending messages
 * 
 * Features:
 * - Auto-resizing textarea
 * - Character count
 * - Ctrl+Enter to send
 * - Send button disabled when empty
 * 
 * @example
 * ```tsx
 * <MessageInput
 *   onSend={async (message) => {
 *     await sendMessage(message)
 *   }}
 *   isSending={isSending}
 * />
 * ```
 */
export function MessageInput({
  onSend,
  disabled = false,
  isSending = false,
  placeholder = 'Type a message...',
  maxLength = 2000,
  className,
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [message])

  const handleSend = async () => {
    if (!message.trim() || disabled || isSending) return

    const messageToSend = message.trim()
    setMessage('')
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await onSend(messageToSend)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const characterCount = message.length
  const isOverLimit = characterCount > maxLength

  return (
    <div className={cn('border-t border-gray-200 p-4 bg-white', className)}>
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSending}
            maxLength={maxLength}
            rows={1}
            className={cn(
              'w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-forest-500 focus:border-forest-500',
              'resize-none overflow-hidden',
              'disabled:bg-gray-50 disabled:cursor-not-allowed',
              isOverLimit && 'border-red-500 focus:border-red-500 focus:ring-red-500'
            )}
            style={{ minHeight: '44px', maxHeight: '200px' }}
          />
          {maxLength && (
            <div className="absolute bottom-2 right-2 text-xs text-gray-400">
              <span className={isOverLimit ? 'text-red-500' : ''}>
                {characterCount}/{maxLength}
              </span>
            </div>
          )}
        </div>
        <Button
          onClick={handleSend}
          disabled={!message.trim() || disabled || isSending || isOverLimit}
          className="h-11 px-4"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Press Ctrl+Enter to send
      </p>
    </div>
  )
}

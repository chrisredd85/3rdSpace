'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Download, FileText, Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SenderType = 'builder' | 'vendor'

type MessageAttachment = {
  name: string
  path: string
  size: number
  type: string
  url?: string
}

type ThreadMessage = {
  id: string
  thread_id: string
  sender_id: string
  sender_type: SenderType
  message: string
  attachments: MessageAttachment[]
  read_at: string | null
  created_at: string
}

interface MessageThreadProps {
  threadId: string
  onMessagesRead?: () => void
}

/**
 * Renders a polling message thread with attachments and read receipts.
 */
export function MessageThread({ threadId, onMessagesRead }: MessageThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [currentUserType, setCurrentUserType] = useState<SenderType | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [search, setSearch] = useState('')
  const [typing, setTyping] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)

  const loadMessages = useCallback(async (query = '') => {
    setLoading(true)
    setError(null)

    try {
      const suffix = query ? `?q=${encodeURIComponent(query)}` : ''
      const res = await fetch(`/api/messages/${threadId}${suffix}`)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to load messages')

      setMessages(data.messages || [])
      setCurrentUserType(data.current_user_type || null)
      onMessagesRead?.()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [onMessagesRead, threadId])

  const pollNewMessages = useCallback(async () => {
    if (messages.length === 0 || search.trim()) return

    const lastMessageId = messages[messages.length - 1].id
    const res = await fetch(`/api/messages/${threadId}?after=${lastMessageId}`)
    const data = await res.json()

    if (res.ok && data.messages?.length > 0) {
      setMessages((previous) => [...previous, ...data.messages])
      onMessagesRead?.()
    }
  }, [messages, onMessagesRead, search, threadId])

  const pollTypingState = useCallback(async () => {
    const res = await fetch(`/api/messages/typing?threadId=${threadId}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setTyping(Boolean(data.typing))
  }, [threadId])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    const interval = window.setInterval(pollNewMessages, 5000)
    return () => window.clearInterval(interval)
  }, [pollNewMessages])

  useEffect(() => {
    const interval = window.setInterval(pollTypingState, 3000)
    return () => window.clearInterval(interval)
  }, [pollTypingState])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /**
   * Sends typing state to the API with a small debounce.
   */
  function handleMessageChange(value: string) {
    setNewMessage(value)

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      fetch('/api/messages/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      }).catch(() => undefined)
    }, 300)
  }

  /**
   * Sends the current message and attached files.
   */
  async function sendMessage() {
    if (!newMessage.trim() && selectedFiles.length === 0) return

    setSending(true)
    setError(null)

    try {
      const hasFiles = selectedFiles.length > 0
      const body = hasFiles ? new FormData() : JSON.stringify({ threadId, message: newMessage })
      const headers: HeadersInit = {}

      if (hasFiles && body instanceof FormData) {
        body.append('threadId', threadId)
        body.append('message', newMessage)
        selectedFiles.forEach((file) => body.append('attachments', file))
      } else {
        headers['Content-Type'] = 'application/json'
      }

      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers,
        body,
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to send message')

      setMessages((previous) => [...previous, data.message])
      setNewMessage('')
      setSelectedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  /**
   * Sends on Enter while preserving Shift+Enter for multi-line messages.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  /**
   * Tracks selected files before upload.
   */
  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files || []))
  }

  /**
   * Runs a message body search for this thread.
   */
  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    loadMessages(search)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <form onSubmit={handleSearchSubmit} className="border-b border-border p-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search messages"
          className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none transition-colors focus:border-primary"
        />
      </form>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading messages...</div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No messages found</div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isOwnMessage = message.sender_type === currentUserType

              return (
                <div key={message.id} className={cn('flex', isOwnMessage ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                      isOwnMessage ? 'bg-primary/90 text-white' : 'bg-sidebar-accent/40 text-foreground'
                    )}
                  >
                    {message.message && <p className="whitespace-pre-wrap break-words">{message.message}</p>}
                    {message.attachments?.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {message.attachments.map((attachment) => (
                          <a
                            key={`${message.id}-${attachment.path || attachment.url}`}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                              isOwnMessage ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20' : 'bg-card/40 hover:bg-background'
                            )}
                          >
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                            <Download className="h-4 w-4 shrink-0" />
                          </a>
                        ))}
                      </div>
                    )}
                    <p className={cn('mt-1 text-xs', isOwnMessage ? 'text-primary/20' : 'text-muted-foreground')}>
                      {formatMessageTime(message.created_at)}
                      {message.read_at && isOwnMessage ? ' • Read' : ''}
                    </p>
                  </div>
                </div>
              )
            })}
            {typing && <p className="text-xs text-muted-foreground">Typing...</p>}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        {selectedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedFiles.map((file) => (
              <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-sidebar-accent/40 px-3 py-1 text-xs text-foreground">
                <Paperclip className="h-3 w-3" />
                <span className="truncate">{file.name}</span>
                <button type="button" onClick={() => setSelectedFiles((files) => files.filter((item) => item !== file))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <textarea
            value={newMessage}
            onChange={(event) => handleMessageChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={2}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border px-4 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
          <Button
            type="button"
            onClick={sendMessage}
            disabled={(!newMessage.trim() && selectedFiles.length === 0) || sending}
            size="icon"
            aria-label="Send message"
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Formats a message timestamp for compact thread display.
 */
function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

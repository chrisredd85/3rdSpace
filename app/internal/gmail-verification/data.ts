import 'server-only'

import {
  getUsableGmailAccessToken,
  listGmailRecentThreads,
  listGmailThreadMessages,
} from '@/lib/outreach/gmail'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database-generated'
import type { GmailVerificationThread } from './types'

type CreatorEmailAccount = Database['public']['Tables']['creator_email_accounts']['Row']

type ReadyContext = {
  status: 'ready'
  db: { from(table: string): any }
  userId: string
  account: CreatorEmailAccount
  accessToken: string
}

export type GmailVerificationContext =
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'missing_gmail' }
  | ReadyContext

const GMAIL_ACCOUNT_SELECT = [
  'id',
  'user_id',
  'provider',
  'email_address',
  'oauth_access_token',
  'oauth_refresh_token',
  'token_expires_at',
  'history_id',
  'label_id',
  'revoked_at',
  'created_at',
].join(', ')

export async function loadGmailVerificationContext(): Promise<GmailVerificationContext> {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return { status: 'unauthenticated' }
  if (user.user_metadata?.user_type !== 'community_builder') return { status: 'forbidden' }

  const { data: account, error: accountError } = await db
    .from('creator_email_accounts')
    .select(GMAIL_ACCOUNT_SELECT)
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (accountError) throw new Error(`Failed to load Gmail connection: ${accountError.message}`)
  if (!account) return { status: 'missing_gmail' }

  const accessToken = await getUsableGmailAccessToken({
    db,
    account: account as CreatorEmailAccount,
  })

  return {
    status: 'ready',
    db,
    userId: user.id,
    account: account as CreatorEmailAccount,
    accessToken,
  }
}

export async function loadGmailVerificationThreadsForContext(
  context: ReadyContext
): Promise<GmailVerificationThread[]> {
  const recentThreads = await listGmailRecentThreads({
    accessToken: context.accessToken,
    maxResults: 10,
  })

  const detailedThreads = await Promise.all(
    recentThreads.map(async (thread) => {
      const messages = await listGmailThreadMessages({
        accessToken: context.accessToken,
        gmailThreadId: thread.gmailThreadId,
      })
      const firstMessage = messages[0] ?? null
      const lastMessage = messages[messages.length - 1] ?? firstMessage
      const bodySnippet = lastMessage?.bodyText ? clipText(lastMessage.bodyText, 180) : ''

      return {
        gmailThreadId: thread.gmailThreadId,
        sender: lastMessage?.from ?? firstMessage?.from ?? 'Unknown sender',
        subject: lastMessage?.subject ?? firstMessage?.subject ?? '(no subject)',
        snippet: thread.snippet || bodySnippet,
        timestamp: lastMessage?.receivedAt ?? firstMessage?.receivedAt ?? null,
        messages: messages.map((message) => ({
          gmailMessageId: message.gmailMessageId,
          from: message.from,
          subject: message.subject,
          bodyText: message.bodyText,
          receivedAt: message.receivedAt,
        })),
      } satisfies GmailVerificationThread
    })
  )

  return detailedThreads
}

function clipText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

'use server'

import { revalidatePath } from 'next/cache'
import {
  loadGmailVerificationContext,
  loadGmailVerificationThreadsForContext,
} from './data'
import type { GmailVerificationActionResult, GmailVerificationThread } from './types'
import {
  modifyGmailThread,
  sendGmailMessage,
} from '@/lib/outreach/gmail'

export async function sendGmailVerificationMessage(
  _previousState: GmailVerificationActionResult | null,
  formData: FormData
): Promise<GmailVerificationActionResult> {
  const context = await loadEnabledReadyContext()
  if ('error' in context) return context.error

  const to = readFormString(formData, 'to')
  const subject = readFormString(formData, 'subject')
  const bodyText = readFormString(formData, 'body')

  if (!to || !subject || !bodyText) {
    return { ok: false, message: 'To, subject, and body are required.' }
  }

  try {
    // Verification-only bypass: this hidden route exists solely for Google's
    // restricted scope review. Real product sends must use the agent outreach
    // loop and its approval/policy gates before Gmail delivery.
    const sent = await sendGmailMessage({
      accessToken: context.accessToken,
      from: context.account.email_address,
      replyTo: context.account.email_address,
      to,
      subject,
      bodyText,
    })
    revalidatePath('/internal/gmail-verification')

    return {
      ok: true,
      message: `Sent through Gmail as ${context.account.email_address}.`,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.gmailThreadId,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to send Gmail verification message.',
    }
  }
}

export async function listGmailVerificationThreads(): Promise<{
  ok: boolean
  threads: GmailVerificationThread[]
  message?: string
}> {
  const context = await loadEnabledReadyContext()
  if ('error' in context) {
    return { ok: false, threads: [], message: context.error.message }
  }

  try {
    const threads = await loadGmailVerificationThreadsForContext(context)
    return { ok: true, threads }
  } catch (error) {
    return {
      ok: false,
      threads: [],
      message: error instanceof Error ? error.message : 'Failed to load Gmail threads.',
    }
  }
}

export async function modifyGmailVerificationThread(
  _previousState: GmailVerificationActionResult | null,
  formData: FormData
): Promise<GmailVerificationActionResult> {
  const context = await loadEnabledReadyContext()
  if ('error' in context) return context.error

  const gmailThreadId = readFormString(formData, 'gmailThreadId')
  const action = readFormString(formData, 'action')
  if (!gmailThreadId) return { ok: false, message: 'Missing Gmail thread id.' }

  const labelUpdate = getLabelUpdate(action)
  if (!labelUpdate) return { ok: false, message: 'Unsupported Gmail thread action.' }

  try {
    await modifyGmailThread({
      accessToken: context.accessToken,
      gmailThreadId,
      ...labelUpdate,
    })
    revalidatePath('/internal/gmail-verification')

    return {
      ok: true,
      message: `Thread ${action} update completed.`,
      gmailThreadId,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to update Gmail thread.',
    }
  }
}

async function loadEnabledReadyContext() {
  if (process.env.ENABLE_GMAIL_VERIFICATION_DEMO !== 'true') {
    return { error: { ok: false, message: 'Gmail verification demo is disabled.' } }
  }

  const context = await loadGmailVerificationContext()
  if (context.status === 'ready') return context
  if (context.status === 'missing_gmail') {
    return { error: { ok: false, message: 'Connect Gmail in Settings before using this demo.' } }
  }
  if (context.status === 'forbidden') {
    return { error: { ok: false, message: 'Only community builder accounts can use this demo.' } }
  }

  return { error: { ok: false, message: 'Sign in before using this demo.' } }
}

function getLabelUpdate(action: string) {
  switch (action) {
    case 'read':
      return { removeLabelIds: ['UNREAD'] }
    case 'unread':
      return { addLabelIds: ['UNREAD'] }
    case 'archive':
      return { removeLabelIds: ['INBOX'] }
    default:
      return null
  }
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export type GmailVerificationMessage = {
  gmailMessageId: string
  from: string | null
  subject: string
  bodyText: string
  receivedAt: string
}

export type GmailVerificationThread = {
  gmailThreadId: string
  sender: string
  subject: string
  snippet: string
  timestamp: string | null
  messages: GmailVerificationMessage[]
}

export type GmailVerificationActionResult = {
  ok: boolean
  message: string
  gmailMessageId?: string
  gmailThreadId?: string
}

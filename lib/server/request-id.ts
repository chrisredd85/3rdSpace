export function createRequestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto)
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function ensureRequestIdHeaders(headers: Headers): { headers: Headers; requestId: string } {
  const nextHeaders = new Headers(headers)
  const requestId = nextHeaders.get('x-request-id') ?? createRequestId()
  nextHeaders.set('x-request-id', requestId)
  return { headers: nextHeaders, requestId }
}

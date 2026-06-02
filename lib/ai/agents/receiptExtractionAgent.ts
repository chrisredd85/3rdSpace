import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { buildAgentRunMetadata, emptyAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'

export const receiptExtractionConfidenceSchema = z.enum(['low', 'medium', 'high'])

export const receiptExtractionOutputSchema = z.object({
  vendor_or_payee: z.string().trim().default(''),
  amount_cents: z.number().int().nonnegative().nullable(),
  paid_at: z.string().trim().min(1).nullable(),
  payment_method: z.string().trim().min(1).nullable(),
  confidence: receiptExtractionConfidenceSchema,
  raw_ocr_text: z.string().default(''),
})

export const RECEIPT_EXTRACTION_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/pdf',
] as const

export type ReceiptExtractionOutput = z.infer<typeof receiptExtractionOutputSchema>
export type ReceiptExtractionResult = Omit<AgentResult<ReceiptExtractionOutput>, 'agent_name'> & {
  agent_name: typeof receiptExtractionAgentDefinition.agentName
}

export type ReceiptExtractionInput = {
  imageUrl?: string
  fileBuffer?: Buffer | Uint8Array | ArrayBuffer
  mimeType?: string
  filename?: string
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

export const receiptExtractionAgentDefinition = {
  agentName: 'receipt_extraction',
  model: 'gpt-4o-mini',
} as const

const SYSTEM_PROMPT = [
  'You extract payment receipt facts for 3rdPlace event cost reconciliation.',
  'Return JSON only. Never infer a payment that is not visible in the receipt.',
  'Use amount_cents for the final paid amount in integer cents.',
  'Use confidence high only when payee, amount, and payment date or paid status are clear.',
  'Use low confidence when the document is not a receipt, the total is ambiguous, or key fields are missing.',
].join('\n')

const OUTPUT_CONTRACT = {
  vendor_or_payee: 'string',
  amount_cents: 'integer cents or null',
  paid_at: 'ISO date string or null',
  payment_method: 'string or null',
  confidence: 'low | medium | high',
  raw_ocr_text: 'short visible text summary, especially on low confidence',
}

export async function runReceiptExtractionAgent(
  payload: ReceiptExtractionInput,
  client: ChatCompletionClient = openai.chat.completions
): Promise<ReceiptExtractionResult> {
  const startedAt = Date.now()
  const prepared = await prepareReceiptInput(payload)

  if (prepared.kind === 'empty') {
    return {
      agent_name: receiptExtractionAgentDefinition.agentName,
      status: 'succeeded',
      ...emptyAgentRunMetadata(receiptExtractionAgentDefinition.model),
      duration_ms: Date.now() - startedAt,
      output: prepared.output,
    }
  }

  assertOpenAIConfigured()

  const prompt = [
    `Output JSON must match this contract: ${JSON.stringify(OUTPUT_CONTRACT)}.`,
    prepared.metadataText,
    prepared.kind === 'text' ? prepared.text : 'Inspect the receipt image and extract payment facts.',
  ].join('\n\n')

  const metadataMessages: AgentMessagePayload = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]

  const messages = prepared.kind === 'vision'
    ? [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...prepared.imageUrls.map((url) => ({
              type: 'image_url',
              image_url: { url },
            })),
          ],
        },
      ]
    : [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ]

  const completion = await client.create({
    model: receiptExtractionAgentDefinition.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: messages as never,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, receiptExtractionAgentDefinition.model, metadataMessages, content)
  if (!content) {
    throw new AgentRunExecutionError('receipt extraction returned an empty model response', metadata)
  }

  let output: ReceiptExtractionOutput
  try {
    output = receiptExtractionOutputSchema.parse(JSON.parse(content))
  } catch (error) {
    throw new AgentRunExecutionError(
      error instanceof Error ? error.message : 'Failed to parse receipt extraction JSON',
      metadata,
      error
    )
  }

  return {
    agent_name: receiptExtractionAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

type PreparedReceiptInput =
  | { kind: 'vision'; imageUrls: string[]; metadataText: string }
  | { kind: 'text'; text: string; metadataText: string }
  | { kind: 'empty'; output: ReceiptExtractionOutput }

async function prepareReceiptInput(input: ReceiptExtractionInput): Promise<PreparedReceiptInput> {
  const mimeType = input.mimeType?.trim().toLowerCase() ?? ''
  const buffer = getBuffer(input.fileBuffer)
  const metadataText = [
    input.filename ? `Filename: ${input.filename}` : null,
    mimeType ? `MIME type: ${mimeType}` : null,
  ].filter(Boolean).join('\n')

  if (input.imageUrl) {
    return { kind: 'vision', imageUrls: [input.imageUrl], metadataText }
  }

  if (!buffer) {
    return emptyReceipt('No receipt image or file was supplied')
  }

  if (mimeType.startsWith('image/')) {
    return {
      kind: 'vision',
      imageUrls: [`data:${mimeType};base64,${buffer.toString('base64')}`],
      metadataText,
    }
  }

  if (mimeType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText({ first: 3 })
      const text = normalizeWhitespace(result.text ?? '')
      if (text) return { kind: 'text', text, metadataText }
      return emptyReceipt('PDF did not contain readable receipt text')
    } finally {
      await parser.destroy()
    }
  }

  return emptyReceipt(`Unsupported receipt file type: ${mimeType || 'unknown'}`)
}

function emptyReceipt(reason: string): PreparedReceiptInput {
  return {
    kind: 'empty',
    output: {
      vendor_or_payee: '',
      amount_cents: null,
      paid_at: null,
      payment_method: null,
      confidence: 'low',
      raw_ocr_text: reason,
    },
  }
}

function getBuffer(value: ReceiptExtractionInput['fileBuffer']): Buffer | null {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(value)
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

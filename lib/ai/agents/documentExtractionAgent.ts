import 'server-only'

import type OpenAI from 'openai'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, emptyAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const documentExtractionModeSchema = z.enum(['headcount', 'venue_revenue'])
export const documentExtractionConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const documentExtractionOutputSchema = z.object({
  extracted_value: z.number().int().nonnegative().nullable(),
  confidence: documentExtractionConfidenceSchema,
  reasoning: z.string().trim().min(1),
  raw_text_seen: z.string(),
})

const documentExtractionInputSchema = z.object({
  imageUrl: z.string().url().optional(),
  mode: documentExtractionModeSchema,
  mimeType: z.string().trim().min(1).optional(),
  filename: z.string().trim().min(1).optional(),
  fileBase64: z.string().trim().min(1).optional(),
  textContent: z.string().optional(),
}).passthrough()

export type DocumentExtractionMode = z.infer<typeof documentExtractionModeSchema>
export type DocumentExtractionOutput = z.infer<typeof documentExtractionOutputSchema>
export type DocumentExtractionResult = AgentResult<DocumentExtractionOutput>

export type DocumentExtractionInput = z.infer<typeof documentExtractionInputSchema> & {
  fileBuffer?: Buffer | Uint8Array | ArrayBuffer
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

export const documentExtractionAgentDefinition = {
  agentName: 'document_extraction',
  model: 'gpt-4o',
} as const

export const DOCUMENT_EXTRACTION_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/pdf',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const

type PreparedExtractionInput =
  | {
      kind: 'vision'
      imageUrls: string[]
      metadataText: string
    }
  | {
      kind: 'text'
      text: string
      metadataText: string
    }
  | {
      kind: 'empty'
      output: DocumentExtractionOutput
    }

const JSON_OUTPUT_INSTRUCTIONS = [
  'Return JSON only.',
  'Shape: {"extracted_value": number|null, "confidence": "high"|"medium"|"low", "reasoning": string, "raw_text_seen": string}.',
  'Confidence: high = one clearly labeled number; medium = number visible but label ambiguous; low = partially obscured, multiple competing numbers, poor quality, or no extractable data.',
  'If nothing extractable, return extracted_value null, confidence low, and explain why.',
].join('\n')

const HEADCOUNT_PROMPT = [
  'You extract verified attendance/headcount from event platform screenshots, exports, or reports.',
  'Look for "checked in", "attended", or "scanned" first.',
  'Fall back to "registered", "RSVP\'d", "RSVP", or "going" only when verified check-in/attendance/scanned counts are absent.',
  'If both checked-in and registered numbers appear, prefer the smaller checked-in number.',
  'Return an integer people count only. Do not return dollar amounts.',
  'Common sources: Eventbrite, Luma, Partiful, Posh, Excel, CSV, PDF exports, or hand-written notes.',
].join('\n')

const VENUE_REVENUE_PROMPT = [
  'You extract venue revenue from POS screenshots, exports, or reports.',
  'Look for "net sales", "subtotal", or "total"; prefer net sales over gross sales.',
  'Return integer cents. Convert dollars to cents by multiplying by 100 and rounding to the nearest integer.',
  'Ignore tax-only or tip-only line items unless they are part of a single total.',
  'Common sources: Square daily summary, Toast POS export, Clover, bar tab receipts, Excel exports, CSV exports, and daily sales screenshots.',
].join('\n')

export async function runDocumentExtractionAgent(
  payload: DocumentExtractionInput | unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<DocumentExtractionResult> {
  const startedAt = Date.now()
  const input = normalizeExtractionInput(payload)
  const prepared = await prepareExtractionInput(input)

  if (prepared.kind === 'empty') {
    return {
      agent_name: documentExtractionAgentDefinition.agentName,
      status: 'succeeded',
      ...emptyAgentRunMetadata(documentExtractionAgentDefinition.model),
      duration_ms: Date.now() - startedAt,
      output: prepared.output,
    }
  }

  assertOpenAIConfigured()

  const systemPrompt = getSystemPrompt(input.mode)
  const prompt = [
    getModePrompt(input.mode),
    JSON_OUTPUT_INSTRUCTIONS,
    prepared.metadataText,
  ].filter(Boolean).join('\n\n')

  const metadataMessages: AgentMessagePayload = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  const messages = prepared.kind === 'vision'
    ? buildVisionMessages(systemPrompt, prompt, prepared.imageUrls)
    : buildTextMessages(systemPrompt, prompt, prepared.text)

  const completion = await client.create({
    model: documentExtractionAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages: messages as never,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, documentExtractionAgentDefinition.model, metadataMessages, content)
  if (!content) {
    throw new AgentRunExecutionError('document_extraction returned an empty model response', metadata)
  }

  let output: DocumentExtractionOutput
  try {
    output = documentExtractionOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: documentExtractionAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

async function prepareExtractionInput(input: DocumentExtractionInput): Promise<PreparedExtractionInput> {
  if (input.textContent !== undefined) {
    const text = normalizeWhitespace(input.textContent)
    if (!text) return emptyExtraction('File contained no data')
    return {
      kind: 'text',
      text,
      metadataText: buildFileMetadata(input, 'Parsed text input.'),
    }
  }

  if (input.imageUrl) {
    return {
      kind: 'vision',
      imageUrls: [input.imageUrl],
      metadataText: buildFileMetadata(input, 'Image URL supplied.'),
    }
  }

  const buffer = getInputBuffer(input)
  if (!buffer) {
    return emptyExtraction('No image URL, file buffer, base64 file, or text content was supplied')
  }

  const mimeType = normalizeMimeType(input.mimeType)
  if (isImageMimeType(mimeType)) {
    return {
      kind: 'vision',
      imageUrls: [toDataUrl(buffer, mimeType)],
      metadataText: buildFileMetadata(input, 'Image file supplied.'),
    }
  }

  if (mimeType === 'application/pdf') {
    return preparePdfInput(input, buffer)
  }

  if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') {
    return prepareDelimitedInput(input, buffer, mimeType)
  }

  if (isSpreadsheetMimeType(mimeType)) {
    return prepareSpreadsheetInput(input, buffer)
  }

  return emptyExtraction(`Unsupported file type: ${mimeType || 'unknown'}`)
}

async function preparePdfInput(input: DocumentExtractionInput, buffer: Buffer): Promise<PreparedExtractionInput> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const textResult = await parser.getText({ first: 3 })
    const text = normalizeWhitespace(textResult.text ?? '')
    if (text.length >= 50) {
      return {
        kind: 'text',
        text,
        metadataText: buildFileMetadata(input, 'PDF text extracted from the first 3 pages.'),
      }
    }

    const screenshotResult = await parser.getScreenshot({
      first: 3,
      desiredWidth: 1200,
      imageDataUrl: true,
      imageBuffer: false,
    })
    const imageUrls = screenshotResult.pages
      .map((page) => page.dataUrl)
      .filter((url): url is string => Boolean(url))

    if (imageUrls.length > 0) {
      return {
        kind: 'vision',
        imageUrls,
        metadataText: buildFileMetadata(input, 'PDF had little extractable text; rendered first 3 pages for vision extraction.'),
      }
    }

    return emptyExtraction('PDF contained no extractable text or renderable pages')
  } catch (error) {
    if (isPasswordProtectedPdfError(error)) {
      return emptyExtraction('PDF is password-protected')
    }
    return emptyExtraction(`PDF could not be parsed: ${getErrorMessage(error)}`)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

function prepareDelimitedInput(input: DocumentExtractionInput, buffer: Buffer, mimeType: string): PreparedExtractionInput {
  const rawText = buffer.toString('utf8')
  const parsed = Papa.parse<string[]>(rawText, {
    delimiter: mimeType === 'text/tab-separated-values' ? '\t' : undefined,
    skipEmptyLines: false,
  })
  const rows = Array.isArray(parsed.data) ? parsed.data : []
  const flattened = rows
    .map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()).join(' | ') : String(row ?? '').trim())
    .filter(Boolean)
    .join('\n')

  const text = normalizeWhitespace(flattened)
  if (!text) return emptyExtraction('File contained no data')

  return {
    kind: 'text',
    text,
    metadataText: buildFileMetadata(input, `${mimeType === 'text/tab-separated-values' ? 'TSV' : 'CSV'} rows flattened to text.`),
  }
}

function prepareSpreadsheetInput(input: DocumentExtractionInput, buffer: Buffer): PreparedExtractionInput {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    const rows = csv
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .join('\n')
    return rows ? `Sheet: ${sheetName}\n${rows}` : ''
  }).filter(Boolean)

  const text = normalizeWhitespace(sections.join('\n\n'))
  if (!text) return emptyExtraction('File contained no data')

  return {
    kind: 'text',
    text,
    metadataText: buildFileMetadata(input, 'Spreadsheet sheets flattened to labeled text sections.'),
  }
}

function buildTextMessages(systemPrompt: string, prompt: string, text: string) {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${prompt}\n\nExtract from this parsed text:\n\n${truncateForModel(text)}`,
    },
  ]
}

function buildVisionMessages(systemPrompt: string, prompt: string, imageUrls: string[]) {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...imageUrls.map((url) => ({
          type: 'image_url',
          image_url: {
            url,
            detail: 'high',
          },
        })),
      ],
    },
  ]
}

function normalizeExtractionInput(payload: DocumentExtractionInput | unknown): DocumentExtractionInput {
  const parsed = documentExtractionInputSchema.parse(payload)
  return {
    ...parsed,
    fileBuffer: (payload as DocumentExtractionInput)?.fileBuffer,
  }
}

function getInputBuffer(input: DocumentExtractionInput): Buffer | null {
  if (input.fileBuffer) {
    if (Buffer.isBuffer(input.fileBuffer)) return input.fileBuffer
    if (input.fileBuffer instanceof Uint8Array) return Buffer.from(input.fileBuffer)
    return Buffer.from(input.fileBuffer)
  }

  if (input.fileBase64) {
    return Buffer.from(input.fileBase64, 'base64')
  }

  return null
}

function getSystemPrompt(mode: DocumentExtractionMode) {
  return [
    'You are the 3rdSpace Document Extraction Agent.',
    'Extract only the requested operational metric from the provided document.',
    mode === 'headcount'
      ? 'The requested metric is event attendance/headcount.'
      : 'The requested metric is venue revenue in cents.',
    'Do not infer missing values. Do not estimate. Use only visible or parsed source data.',
  ].join('\n')
}

function getModePrompt(mode: DocumentExtractionMode) {
  return mode === 'headcount' ? HEADCOUNT_PROMPT : VENUE_REVENUE_PROMPT
}

function buildFileMetadata(input: DocumentExtractionInput, note: string) {
  return [
    `Mode: ${input.mode}`,
    input.filename ? `Filename: ${input.filename}` : null,
    input.mimeType ? `MIME type: ${input.mimeType}` : null,
    note,
  ].filter(Boolean).join('\n')
}

function emptyExtraction(reasoning: string): PreparedExtractionInput {
  return {
    kind: 'empty',
    output: {
      extracted_value: null,
      confidence: 'low',
      reasoning,
      raw_text_seen: '',
    },
  }
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Model response was not valid JSON')
    return JSON.parse(match[0])
  }
}

function normalizeMimeType(mimeType: string | undefined) {
  return (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/')
}

function isSpreadsheetMimeType(mimeType: string) {
  return mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
}

function toDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function normalizeWhitespace(text: string) {
  return text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

function truncateForModel(text: string) {
  const maxChars = 60_000
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[Truncated after ${maxChars} characters]`
}

function isPasswordProtectedPdfError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  const name = typeof error === 'object' && error && 'name' in error
    ? String((error as { name?: unknown }).name ?? '').toLowerCase()
    : ''
  return name.includes('password') || message.includes('password')
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

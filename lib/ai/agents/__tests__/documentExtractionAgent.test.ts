jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { agentNameSchema } from '@/lib/ai/types'
import { runDocumentExtractionAgent } from '@/lib/ai/agents/documentExtractionAgent'
import * as XLSX from 'xlsx'

const previousOpenAiKey = process.env.OPENAI_API_KEY

describe('documentExtractionAgent', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
  })

  afterAll(() => {
    process.env.OPENAI_API_KEY = previousOpenAiKey
  })

  it('registers document_extraction as a distinct agent name', () => {
    expect(agentNameSchema.parse('document_extraction')).toBe('document_extraction')
  })

  it('flattens CSV text and returns the structured extraction output', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      choices: [{
        message: {
          content: JSON.stringify({
            extracted_value: 87,
            confidence: 'high',
            reasoning: 'Checked-in count was clearly labeled.',
            raw_text_seen: 'Checked in | 87',
          }),
        },
      }],
    })

    const result = await runDocumentExtractionAgent(
      {
        mode: 'headcount',
        mimeType: 'text/csv',
        filename: 'eventbrite.csv',
        fileBuffer: Buffer.from('Metric,Count\nRegistered,100\nChecked in,87\n'),
      },
      { create } as never
    )

    expect(result.agent_name).toBe('document_extraction')
    expect(result.output.extracted_value).toBe(87)
    expect(create).toHaveBeenCalledTimes(1)
    const request = create.mock.calls[0][0]
    expect(request.model).toBe('gpt-4o')
    expect(request.messages[1].content).toContain('Checked in | 87')
  })

  it('uses vision input for image URLs', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 20, completion_tokens: 10 },
      choices: [{
        message: {
          content: JSON.stringify({
            extracted_value: 428000,
            confidence: 'medium',
            reasoning: 'A total was visible but the net label was ambiguous.',
            raw_text_seen: 'Total $4,280.00',
          }),
        },
      }],
    })

    await runDocumentExtractionAgent(
      {
        mode: 'venue_revenue',
        imageUrl: 'https://example.com/square-summary.png',
      },
      { create } as never
    )

    const request = create.mock.calls[0][0]
    expect(Array.isArray(request.messages[1].content)).toBe(true)
    expect(request.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/square-summary.png',
        detail: 'high',
      },
    })
  })

  it('returns low confidence without calling the model for empty tabular files', async () => {
    const create = jest.fn()

    const result = await runDocumentExtractionAgent(
      {
        mode: 'headcount',
        mimeType: 'text/csv',
        filename: 'empty.csv',
        fileBuffer: Buffer.from('\n\n'),
      },
      { create } as never
    )

    expect(create).not.toHaveBeenCalled()
    expect(result.output).toEqual({
      extracted_value: null,
      confidence: 'low',
      reasoning: 'File contained no data',
      raw_text_seen: '',
    })
  })

  it('flattens all XLSX sheets with sheet labels before extraction', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 18, completion_tokens: 8 },
      choices: [{
        message: {
          content: JSON.stringify({
            extracted_value: 428000,
            confidence: 'high',
            reasoning: 'Net sales was clearly labeled on the Square sheet.',
            raw_text_seen: 'Net Sales,$4,280.00',
          }),
        },
      }],
    })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Metric', 'Amount'], ['Net Sales', '$4,280.00']]),
      'Square'
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Metric', 'Amount'], ['Tips', '$610.00']]),
      'Tips'
    )
    const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await runDocumentExtractionAgent(
      {
        mode: 'venue_revenue',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'square-summary.xlsx',
        fileBuffer,
      },
      { create } as never
    )

    const request = create.mock.calls[0][0]
    expect(result.output.extracted_value).toBe(428000)
    expect(request.messages[1].content).toContain('Sheet: Square')
    expect(request.messages[1].content).toContain('Net Sales,"$4,280.00"')
    expect(request.messages[1].content).toContain('Sheet: Tips')
  })
})

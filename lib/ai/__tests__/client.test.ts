jest.mock('server-only', () => ({}))

describe('OpenAI client', () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAIKey
    jest.dontMock('openai')
  })

  it('does not construct OpenAI at module import time when the key is missing', async () => {
    delete process.env.OPENAI_API_KEY

    await expect(import('@/lib/ai/client')).resolves.toBeDefined()
  })

  it('throws a helpful error when getOpenAI is called without a key', async () => {
    delete process.env.OPENAI_API_KEY
    const { getOpenAI } = await import('@/lib/ai/client')

    expect(() => getOpenAI()).toThrow(
      'OPENAI_API_KEY is not configured. Set it in .env.local for local development or Vercel environment variables for deployed runtime.'
    )
  })

  it('memoizes the OpenAI instance', async () => {
    const mockOpenAIConstructor = jest.fn().mockImplementation(function MockOpenAI(this: {
      chat: { completions: { create: jest.Mock } }
    }) {
      this.chat = { completions: { create: jest.fn() } }
    })

    jest.doMock('openai', () => ({
      __esModule: true,
      default: mockOpenAIConstructor,
    }))
    process.env.OPENAI_API_KEY = 'test-openai-key'

    const { getOpenAI } = await import('@/lib/ai/client')
    const firstClient = getOpenAI()
    const secondClient = getOpenAI()

    expect(firstClient).toBe(secondClient)
    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1)
    expect(mockOpenAIConstructor).toHaveBeenCalledWith({ apiKey: 'test-openai-key' })
  })

  it('keeps the legacy openai export lazy', async () => {
    const mockCreate = jest.fn()
    const mockOpenAIConstructor = jest.fn().mockImplementation(function MockOpenAI(this: {
      chat: { completions: { create: jest.Mock } }
    }) {
      this.chat = { completions: { create: mockCreate } }
    })

    jest.doMock('openai', () => ({
      __esModule: true,
      default: mockOpenAIConstructor,
    }))
    process.env.OPENAI_API_KEY = 'test-openai-key'

    const { openai } = await import('@/lib/ai/client')

    expect(mockOpenAIConstructor).not.toHaveBeenCalled()
    expect(openai.chat.completions.create).toBe(mockCreate)
    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1)
  })
})

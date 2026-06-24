import { parseNeighborhoodPhrase } from '@/lib/planner/areaParsing'

describe('parseNeighborhoodPhrase', () => {
  it.each([
    ['downtown oakland', ['downtown_oakland']],
    ['downtown or uptown oakland', ['downtown_oakland', 'uptown_oakland']],
    ['mission or soma', ['mission', 'soma']],
    ['downtown oakland, uptown oakland', ['downtown_oakland', 'uptown_oakland']],
    ['downtown/uptown oakland', ['downtown_oakland', 'uptown_oakland']],
    ['mission', ['mission']],
    ['Bay Area', []],
    ['', []],
    ['downtown oakland or downtown oakland', ['downtown_oakland']],
  ])('normalizes %s', (input, expected) => {
    expect(parseNeighborhoodPhrase(input)).toEqual(expected)
  })
})

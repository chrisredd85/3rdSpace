# Testing Guide

This document outlines the testing infrastructure and how to write tests for the 3rdSpace platform.

## Testing Stack

- **Jest** - Unit and integration testing
- **React Testing Library** - Component testing
- **Playwright** - End-to-end testing
- **MSW** - API mocking (when needed)

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Type check
npm run type-check
```

## Test Structure

```
├── __tests__/              # Unit tests
│   ├── lib/
│   │   └── utils/
│   │       ├── filters.test.ts
│   │       └── formatting.test.ts
│   └── components/
│       └── ui/
│           └── button.test.tsx
├── e2e/                    # E2E tests
│   ├── signup.spec.ts
│   ├── login.spec.ts
│   └── event-creation.spec.ts
└── lib/
    └── test-utils.tsx      # Test utilities
```

## Writing Unit Tests

### Testing Utilities

```typescript
import { buildFilterQuery } from '@/lib/utils/filters'

describe('buildFilterQuery', () => {
  it('should apply equals filter', () => {
    const query = createMockQuery()
    const filters = [
      { type: 'equals', column: 'venue_type', value: 'loft_warehouse' },
    ]

    buildFilterQuery(query, filters)

    expect(query.eq).toHaveBeenCalledWith('venue_type', 'loft_warehouse')
  })
})
```

### Testing Components

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'

describe('Button Component', () => {
  it('should handle click events', async () => {
    const handleClick = jest.fn()
    const user = userEvent.setup()

    render(<Button onClick={handleClick}>Click me</Button>)
    
    const button = screen.getByRole('button', { name: /click me/i })
    await user.click(button)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

## Writing Component Tests

### Using Test Utilities

```typescript
import { renderWithProviders } from '@/lib/test-utils'
import { MyComponent } from '@/components/MyComponent'

test('renders component', () => {
  renderWithProviders(<MyComponent />)
  expect(screen.getByText('Hello')).toBeInTheDocument()
})
```

### Testing Form Validation

```typescript
import { renderWithProviders } from '@/lib/test-utils'
import { FormField } from '@/components/forms/FormField'

test('shows validation error', () => {
  renderWithProviders(
    <FormField label="Email" name="email" error="Email is required">
      <input type="email" name="email" />
    </FormField>
  )

  expect(screen.getByText('Email is required')).toBeInTheDocument()
})
```

## Writing E2E Tests

### Basic E2E Test

```typescript
import { test, expect } from '@playwright/test'

test('should login successfully', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('test@example.com')
  await page.getByLabel(/password/i).fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/builder/)
})
```

### Testing User Flows

```typescript
test('should create event', async ({ page }) => {
  // Login
  await page.goto('/login')
  // ... login steps

  // Create event
  await page.goto('/builder/event/new')
  // ... fill form steps
})
```

## Test Utilities

### `renderWithProviders`

Renders a component with all necessary providers (React Query, Toast, etc.)

```typescript
import { renderWithProviders } from '@/lib/test-utils'

renderWithProviders(<MyComponent />)
```

### Mock Data

```typescript
import { mockUser, mockVenue, mockEvent } from '@/lib/test-utils'

// Use in tests
const user = mockUser
const venue = mockVenue
```

### Mock Supabase

```typescript
import { createMockSupabaseClient } from '@/lib/test-utils'

const mockSupabase = createMockSupabaseClient()
```

## Best Practices

1. **Test Behavior, Not Implementation**
   - Test what users see and do
   - Avoid testing internal state

2. **Use Semantic Queries**
   - Prefer `getByRole`, `getByLabelText`
   - Avoid `getByTestId` when possible

3. **Keep Tests Isolated**
   - Each test should be independent
   - Clean up after tests

4. **Write Descriptive Test Names**
   - Use clear, descriptive names
   - Describe what is being tested

5. **Test Error States**
   - Test error handling
   - Test validation messages

6. **Test Loading States**
   - Test loading indicators
   - Test disabled states

## Coverage Goals

- **Unit Tests**: 80%+ coverage for utilities
- **Component Tests**: 70%+ coverage for shared components
- **Integration Tests**: Critical user flows
- **E2E Tests**: Main user journeys

## CI/CD

Tests run automatically on:
- Pull requests
- Pushes to main/develop branches

The CI pipeline:
1. Runs linter
2. Type checks
3. Runs unit tests with coverage
4. Builds the application
5. Runs E2E tests

## Pre-commit Hooks

Before committing, the following run:
- Linter
- Type check
- Unit tests

Install husky (if not already installed):
```bash
npm install --save-dev husky
npx husky install
```

## Debugging Tests

### Jest Debugging

```bash
# Run specific test file
npm test -- filters.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should apply"

# Debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Playwright Debugging

```bash
# Run with UI
npm run test:e2e:ui

# Debug specific test
npx playwright test signup.spec.ts --debug
```

## Common Issues

### "Cannot find module" errors
- Ensure paths are correctly mapped in `tsconfig.json`
- Check `jest.config.js` moduleNameMapper

### Tests timing out
- Increase timeout in test file
- Check for async operations not being awaited

### E2E tests failing
- Ensure dev server is running
- Check base URL in `playwright.config.ts`
- Verify test data exists

## Resources

- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

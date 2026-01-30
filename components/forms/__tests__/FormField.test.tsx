import { render, screen } from '@testing-library/react'
import { FormField } from '../FormField'

describe('FormField Component', () => {
  it('should render label', () => {
    render(
      <FormField label="Email" name="email">
        <input type="email" name="email" />
      </FormField>
    )

    expect(screen.getByText('Email')).toBeInTheDocument()
  })

  it('should render error message', () => {
    render(
      <FormField label="Email" name="email" error="Email is required">
        <input type="email" name="email" />
      </FormField>
    )

    expect(screen.getByText('Email is required')).toBeInTheDocument()
  })

  it('should render helper text', () => {
    render(
      <FormField label="Email" name="email" helperText="Enter your email address">
        <input type="email" name="email" />
      </FormField>
    )

    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
  })

  it('should render required indicator', () => {
    render(
      <FormField label="Email" name="email" required>
        <input type="email" name="email" />
      </FormField>
    )

    const label = screen.getByText('Email')
    expect(label).toHaveTextContent('*')
  })
})

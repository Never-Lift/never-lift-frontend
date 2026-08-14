import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Brand } from '@/components/Brand'

describe('Brand', () => {
  afterEach(cleanup)

  it('uses the approved Never Lift assets and keeps the wordmark accessible', () => {
    render(<Brand tagline="Race control" />)

    expect(screen.getByRole('img', { name: 'Never Lift' })).toHaveAttribute(
      'src',
      '/brand/never-lift-wordmark-white.svg',
    )
    expect(screen.getByText('Race control')).toBeInTheDocument()
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarPicker } from '@/components/AvatarPicker'

describe('AvatarPicker', () => {
  afterEach(cleanup)

  it('offers eight original archetypes and supports an optional selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AvatarPicker onChange={onChange} value={undefined} />)

    expect(screen.getAllByRole('radio')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: 'Sem avatar' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('radio', { name: 'Drifter urbana' }))
    expect(onChange).toHaveBeenCalledWith('street-drifter')
  })
})

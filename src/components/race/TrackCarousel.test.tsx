import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import trackCatalog from '../../../contracts/module-2/v2/catalog.json'
import { TrackCarousel } from '@/components/race/TrackCarousel'
import type { TrackCatalog } from '@/lib/api'
import { SHORT_TRACK } from '@/test/track-fixtures'

const catalog = trackCatalog as TrackCatalog

describe('TrackCarousel', () => {
  afterEach(cleanup)

  it('filters by location and keeps every matching card reachable', async () => {
    const user = userEvent.setup()
    render(
      <TrackCarousel
        catalog={catalog}
        getTrack={vi.fn().mockResolvedValue(SHORT_TRACK)}
        onLoadError={vi.fn()}
        onSelect={vi.fn()}
        selectedId="albert-park"
      />,
    )

    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar circuitos' }), 'monaco')

    expect(screen.getByRole('option', { name: 'Selecionar Circuit de Monaco' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Selecionar Albert Park Circuit' })).not.toBeInTheDocument()
  })

  it('scrolls by dragging the cards and does not select one accidentally', () => {
    const onSelect = vi.fn()
    render(
      <TrackCarousel
        catalog={catalog}
        getTrack={vi.fn().mockResolvedValue(SHORT_TRACK)}
        onLoadError={vi.fn()}
        onSelect={onSelect}
        selectedId="albert-park"
      />,
    )
    const scroller = screen.getByRole('listbox', { name: 'Selecionar pista' })
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: 120, writable: true })

    fireEvent.pointerDown(scroller, { button: 0, clientX: 240, pointerId: 3 })
    fireEvent.pointerMove(scroller, { clientX: 140, pointerId: 3 })
    fireEvent.pointerUp(scroller, { clientX: 140, pointerId: 3 })
    fireEvent.click(screen.getByRole('option', { name: 'Selecionar Shanghai International Circuit' }))

    expect(scroller.scrollLeft).toBe(220)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

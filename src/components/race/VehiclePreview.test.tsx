import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VehiclePreview } from '@/components/race/VehiclePreview'

function createRecordingContext() {
  let fillStyle = '#000000'
  const operations: string[] = []
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'fillStyle') return fillStyle
        if (property === 'fill') {
          return () => operations.push(`fill:${fillStyle}`)
        }
        return (..._arguments: unknown[]) => operations.push(String(property))
      },
      set: (_target, property, value) => {
        if (property === 'fillStyle') fillStyle = String(value)
        return true
      },
    },
  ) as CanvasRenderingContext2D
  return { context, operations }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VehiclePreview', () => {
  it('renders the selected profile through the shared canvas painter', async () => {
    const { context, operations } = createRecordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 320, height: 160 }),
    )

    const { rerender } = render(
      <VehiclePreview color="#2d7dff" profileId="formula" />,
    )

    expect(
      screen.getByRole('img', { name: 'Prévia do carro Fórmula' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(operations).toContain('fill:#2d7dff'))

    const operationCount = operations.length
    rerender(<VehiclePreview color="#ff2e88" profileId="drift" />)

    expect(
      screen.getByRole('img', { name: 'Prévia do carro Drift' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(operations.length).toBeGreaterThan(operationCount)
      expect(operations).toContain('fill:#ff2e88')
    })
  })
})

import '@testing-library/jest-dom/vitest'

// jsdom has no native Canvas implementation. Individual renderer tests replace
// this with recording contexts; UI tests can safely render decorative previews.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})

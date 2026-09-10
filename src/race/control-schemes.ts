export type KeyboardControlSchemeId = 'wasd' | 'arrows' | 'ijkl'

export type KeyboardControlBindings = {
  throttle: string
  brake: string
  left: string
  right: string
}

export type KeyboardControlScheme = {
  id: KeyboardControlSchemeId
  label: string
  keys: readonly [string, string, string, string]
  bindings: KeyboardControlBindings
}

export const KEYBOARD_CONTROL_SCHEMES: readonly KeyboardControlScheme[] = [
  {
    id: 'wasd',
    label: 'WASD',
    keys: ['W', 'A', 'S', 'D'],
    bindings: {
      throttle: 'KeyW',
      brake: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
    },
  },
  {
    id: 'arrows',
    label: 'Setas',
    keys: ['↑', '←', '↓', '→'],
    bindings: {
      throttle: 'ArrowUp',
      brake: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
    },
  },
  {
    id: 'ijkl',
    label: 'IJKL',
    keys: ['I', 'J', 'K', 'L'],
    bindings: {
      throttle: 'KeyI',
      brake: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
    },
  },
] as const

export type KeyboardControlPreferences = {
  version: 1
  primary: KeyboardControlSchemeId
  secondary: KeyboardControlSchemeId
}

export const DEFAULT_KEYBOARD_CONTROL_PREFERENCES: KeyboardControlPreferences = {
  version: 1,
  primary: 'wasd',
  secondary: 'arrows',
}

const STORAGE_KEY = 'never-lift.keyboard-controls.v1'

const schemeIds = new Set<KeyboardControlSchemeId>(
  KEYBOARD_CONTROL_SCHEMES.map((scheme) => scheme.id),
)

export function isKeyboardControlSchemeId(
  value: unknown,
): value is KeyboardControlSchemeId {
  return typeof value === 'string' && schemeIds.has(value as KeyboardControlSchemeId)
}

export function getKeyboardControlScheme(id: KeyboardControlSchemeId) {
  return KEYBOARD_CONTROL_SCHEMES.find((scheme) => scheme.id === id) ?? KEYBOARD_CONTROL_SCHEMES[0]
}

export function firstAvailableKeyboardControlScheme(
  blocked: KeyboardControlSchemeId,
) {
  return KEYBOARD_CONTROL_SCHEMES.find((scheme) => scheme.id !== blocked)?.id ?? 'wasd'
}

export function normalizeKeyboardControlPreferences(
  value: Partial<KeyboardControlPreferences> | null | undefined,
): KeyboardControlPreferences {
  const primary = isKeyboardControlSchemeId(value?.primary)
    ? value.primary
    : DEFAULT_KEYBOARD_CONTROL_PREFERENCES.primary
  const requestedSecondary = isKeyboardControlSchemeId(value?.secondary)
    ? value.secondary
    : DEFAULT_KEYBOARD_CONTROL_PREFERENCES.secondary

  return {
    version: 1,
    primary,
    secondary:
      requestedSecondary === primary
        ? firstAvailableKeyboardControlScheme(primary)
        : requestedSecondary,
  }
}

export function loadKeyboardControlPreferences(): KeyboardControlPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_KEYBOARD_CONTROL_PREFERENCES }
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_KEYBOARD_CONTROL_PREFERENCES }
    return normalizeKeyboardControlPreferences(
      JSON.parse(stored) as Partial<KeyboardControlPreferences>,
    )
  } catch {
    return { ...DEFAULT_KEYBOARD_CONTROL_PREFERENCES }
  }
}

export function saveKeyboardControlPreferences(
  preferences: KeyboardControlPreferences,
) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeKeyboardControlPreferences(preferences)),
    )
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory choice still works.
  }
}

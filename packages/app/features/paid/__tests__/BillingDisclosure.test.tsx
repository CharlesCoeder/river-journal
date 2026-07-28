// @vitest-environment happy-dom
/**
 * BillingDisclosure.test.tsx — the platform-aware disclosure COMPONENT. The
 * pure resolver (`platformDisclosure.ts`) is covered independently in
 * `utils/billing/__tests__/platformDisclosure.test.ts`; this file covers the
 * component that reads the repo's platform idioms (`Platform.OS` for native,
 * `isWeb` from `@my/ui` for web/desktop) and renders the resolver's output.
 *
 * Platform detection idioms: `isWeb` from `@my/ui` is `true`
 * for BOTH web and Tauri desktop (Stripe copy covers both);
 * `Platform.OS === 'ios' | 'android'` for native.
 *
 * Red-phase: `packages/app/features/paid/BillingDisclosure.tsx` does not
 * exist yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── react-native Platform mock — mutable OS, mirrors ReminderSettings.test.tsx ──
let mockPlatformOS = 'web'
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
}))

// ─── @my/ui mock — mutable isWeb + passthrough Text/View ──────────────────────
let mockIsWeb = true
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  const Text = ({ children, ...rest }: any) =>
    ReactModule.createElement('span', { 'data-testid': rest.testID }, children)
  const View = ({ children, ...rest }: any) =>
    ReactModule.createElement('div', { 'data-testid': rest.testID }, children)
  return {
    Text,
    View,
    get isWeb() {
      return mockIsWeb
    },
  }
})

// Import under test — fails until BillingDisclosure.tsx exists.
import { BillingDisclosure } from '../BillingDisclosure'

beforeEach(() => {
  mockPlatformOS = 'web'
  mockIsWeb = true
})

afterEach(() => {
  cleanup()
})

describe('BillingDisclosure — web/desktop', () => {
  it('renders "Purchase via Stripe" when isWeb is true', () => {
    mockIsWeb = true
    mockPlatformOS = 'web'
    render(<BillingDisclosure />)
    expect(screen.getByText('Purchase via Stripe')).toBeTruthy()
  })

  it('renders "Purchase via Stripe" for the Tauri desktop runtime too (isWeb still true)', () => {
    // design notes: Tauri desktop uses the web renderer, so isWeb === true covers
    // both web and desktop — same disclosure copy, no separate desktop branch.
    mockIsWeb = true
    mockPlatformOS = 'web'
    render(<BillingDisclosure />)
    expect(screen.getByText('Purchase via Stripe')).toBeTruthy()
    expect(screen.queryByText('Purchase via the App Store')).toBeNull()
    expect(screen.queryByText('Purchase via the Play Store')).toBeNull()
  })
})

describe('BillingDisclosure — native', () => {
  it('renders "Purchase via the App Store" on iOS', () => {
    mockIsWeb = false
    mockPlatformOS = 'ios'
    render(<BillingDisclosure />)
    expect(screen.getByText('Purchase via the App Store')).toBeTruthy()
  })

  it('renders "Purchase via the Play Store" on Android', () => {
    mockIsWeb = false
    mockPlatformOS = 'android'
    render(<BillingDisclosure />)
    expect(screen.getByText('Purchase via the Play Store')).toBeTruthy()
  })

  it('renders no "web" external-link microcopy on iOS', () => {
    mockIsWeb = false
    mockPlatformOS = 'ios'
    render(<BillingDisclosure />)
    expect(screen.queryByText(/save.*web/i)).toBeNull()
    expect(screen.queryByText(/manage.*web/i)).toBeNull()
  })

  it('renders no "web" external-link microcopy on Android', () => {
    mockIsWeb = false
    mockPlatformOS = 'android'
    render(<BillingDisclosure />)
    expect(screen.queryByText(/save.*web/i)).toBeNull()
    expect(screen.queryByText(/manage.*web/i)).toBeNull()
  })
})

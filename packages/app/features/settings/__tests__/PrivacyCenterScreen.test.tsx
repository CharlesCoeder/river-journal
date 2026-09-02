// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// --- Mocks ---

const mockCurrentMode = vi.fn(() => null)
const mockSyncEnabled = vi.fn(() => false)
const mockIsAuthenticated = vi.fn(() => false)

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  // mapProps forwards testID/onPress (unchanged, original behavior) and
  // ADDITIONALLY forwards role/accessibilityRole/tabIndex/aria-disabled when
  // present, so new v2 assertions can distinguish a pressable posture line
  // from the static, non-focusable AI placeholder line. Purely additive —
  // no existing assertion depended on these being absent.
  const mapProps = (props: Record<string, unknown>) => {
    const {
      testID,
      onPress,
      accessibilityRole,
      role,
      tabIndex,
      'aria-disabled': ariaDisabled,
    } = props as Record<string, unknown> & {
      testID?: string
      onPress?: () => void
      accessibilityRole?: string
      role?: string
      tabIndex?: number
      'aria-disabled'?: string
    }
    const resolvedRole = (accessibilityRole ?? role) as string | undefined
    return {
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(resolvedRole ? { role: resolvedRole } : {}),
      ...(tabIndex !== undefined ? { tabIndex } : {}),
      ...(ariaDisabled !== undefined ? { 'aria-disabled': ariaDisabled } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ScrollView = ({ children, ...props }: any) =>
    ReactModule.createElement('div', mapProps(props), children)

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  const ExpandingLineButton = ({ children, onPress, testID }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        ...(testID ? { 'data-testid': testID } : {}),
        onClick: onPress,
      },
      children
    )

  return {
    AnimatePresence,
    ScrollView,
    Text: passthrough('span'),
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    ExpandingLineButton,
  }
})

// The telemetry consent orchestrator pulls the Sentry SDK; stub it so
// this screen suite stays a light placement/wiring check.
vi.mock('app/utils/telemetry/consent', () => ({
  setTelemetryConsent: vi.fn(),
}))

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_isAuthenticated') return mockIsAuthenticated()
    if (obs$ === '__mock_syncEnabled') return mockSyncEnabled()
    if (obs$ === '__mock_currentMode') return mockCurrentMode()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    session: {
      isAuthenticated: '__mock_isAuthenticated',
      syncEnabled: '__mock_syncEnabled',
    },
  },
}))

vi.mock('app/state/encryptionSetup', () => ({
  encryptionSetup$: {
    currentMode: '__mock_currentMode',
  },
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

// --- v2 child-component stubs ---
//
// Following the SettingsScreen suites' `vi.mock('../components/ExportJournal',
// ...)` precedent: the v2 additions are exercised end-to-end in their OWN
// dedicated test files (ExportCollectivePosts.test.tsx, DeleteAccountFlow.test.tsx
// mount the real components). Here they are stubbed so this screen suite stays
// a light integration check of PLACEMENT/WIRING only — every stub surfaces the
// prop(s) this screen is responsible for passing so that contract stays
// assertable without mounting the real (heavier) child.

vi.mock('../components/ExportJournal', () => ({
  ExportJournal: () => React.createElement('div', { 'data-testid': 'export-journal-mock' }),
}))

vi.mock('../components/ExportCollectivePosts', () => ({
  ExportCollectivePosts: () =>
    React.createElement('div', { 'data-testid': 'export-collective-posts-mock' }),
}))

vi.mock('../components/DeleteAccountFlow', () => ({
  DeleteAccountFlow: ({ open }: { open: boolean }) =>
    React.createElement('div', {
      'data-testid': 'delete-account-flow-mock',
      'data-open': String(open),
    }),
}))

vi.mock('app/features/disclosure/ThreePostureDisclosure', () => ({
  ThreePostureDisclosure: ({
    open,
    boundary,
    mode,
  }: {
    open: boolean
    boundary: string
    mode: string
  }) =>
    open
      ? React.createElement('div', {
          'data-testid': 'posture-review-dialog',
          'data-boundary': boundary,
          'data-mode': mode,
        })
      : null,
}))

import { PrivacyCenterScreen } from '../PrivacyCenterScreen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrivacyCenterScreen', () => {
  describe('renders all content sections', () => {
    it('renders header and description', () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByTestId('privacy-center-screen')).toBeTruthy()
      expect(screen.getByText('Privacy Center')).toBeTruthy()
      expect(screen.getByText('How River Journal handles your data and encryption.')).toBeTruthy()
    })

    it('renders privacy mode cards', async () => {
      render(React.createElement(PrivacyCenterScreen))

      expect((await screen.findAllByText('Strict Privacy Mode')).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Cloud Backup Mode').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('You hold the only key to unlock your journal.')).toBeTruthy()
      expect(screen.getByText('We securely handle the encryption behind the scenes.')).toBeTruthy()
    })

    it('renders what we can and cannot access section', async () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(await screen.findByText('What We Can & Cannot Access')).toBeTruthy()
      expect(screen.getByText('Local Only (No Sync)')).toBeTruthy()
      expect(screen.getByText('Synced Metadata')).toBeTruthy()
    })

    it('renders retention and deletion section', async () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(await screen.findByText('Data Retention & Deletion')).toBeTruthy()
      expect(screen.getByText('Cloud Data')).toBeTruthy()
      expect(screen.getByText('Account Deletion')).toBeTruthy()
      expect(screen.getByText('Local Data')).toBeTruthy()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// v2 additions — pinned contract for the green-phase implementer
//
//   New testids this screen owns directly:
//     - posture lines:  `posture-encrypted-journal`, `posture-collective`
//                        (pressable — open the shared Boundary A review
//                        disclosure), `posture-ai-cloud` (STATIC placeholder
//                        — no onPress, no accessibilityRole="button", not
//                        part of the tab order)
//     - delete entry:    `delete-account-entry` (auth-gated trigger; opens
//                        the always-mounted `<DeleteAccountFlow>` dialog)
//
//   Auth-gating (screen-level):
//     - the v2 posture section (all 3 lines + both review links) is ALWAYS
//       visible, auth or not
//     - `<ExportJournal />` is always mounted, auth or not (carryover,
//       unchanged from v1)
//     - `<ExportCollectivePosts />` is mounted only when isAuthenticated
//       (belt-and-suspenders with the component's own self-null check,
//       independently covered in ExportCollectivePosts.test.tsx)
//     - the "Delete account" entry TRIGGER is visible only when
//       isAuthenticated; the `<DeleteAccountFlow>` DIALOG itself stays
//       mounted regardless (open defaults false) so its own terminal state
//       can survive a later isAuthenticated flip — see DeleteAccountFlow.test.tsx
// ─────────────────────────────────────────────────────────────────────────────

describe('v2 — privacy postures section (always visible, all three postures)', () => {
  it('renders the encrypted-journal posture copy verbatim', async () => {
    render(React.createElement(PrivacyCenterScreen))
    expect(
      await screen.findByText(
        "Your journal entries are encrypted on your device before they ever sync. We can't read them."
      )
    ).toBeTruthy()
  })

  it('renders the server-visible Collective posture copy verbatim', async () => {
    render(React.createElement(PrivacyCenterScreen))
    expect(
      await screen.findByText(
        'Posts you make in the Collective are stored as plain text on our servers. They are visible to other Collective members.'
      )
    ).toBeTruthy()
  })

  it('renders the AI cloud inference reserved-placeholder copy verbatim', async () => {
    render(React.createElement(PrivacyCenterScreen))
    expect(
      await screen.findByText(
        "When AI Reflection ships in a future release, you'll be able to choose between local inference (your writing never leaves your device) or cloud inference (sent to a named provider with a no-training commitment)."
      )
    ).toBeTruthy()
  })

  it('renders all three posture lines for an anonymous (unauthenticated) session too — the section never gates on auth', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    render(React.createElement(PrivacyCenterScreen))

    expect(
      await screen.findByText(
        "Your journal entries are encrypted on your device before they ever sync. We can't read them."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Posts you make in the Collective are stored as plain text on our servers. They are visible to other Collective members.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "When AI Reflection ships in a future release, you'll be able to choose between local inference (your writing never leaves your device) or cloud inference (sent to a named provider with a no-training commitment)."
      )
    ).toBeTruthy()
  })
})

describe('v2 — review-mode disclosure seam', () => {
  it('the encrypted-journal line opens the shared Boundary A review disclosure (collective_post_v1, review mode)', async () => {
    render(React.createElement(PrivacyCenterScreen))
    fireEvent.click(await screen.findByTestId('posture-encrypted-journal'))

    const dialog = await screen.findByTestId('posture-review-dialog')
    expect(dialog.getAttribute('data-boundary')).toBe('collective_post_v1')
    expect(dialog.getAttribute('data-mode')).toBe('review')
  })

  it('the Collective line opens the SAME shared review disclosure (Boundary A copy covers both linked postures)', async () => {
    render(React.createElement(PrivacyCenterScreen))
    fireEvent.click(await screen.findByTestId('posture-collective'))

    const dialog = await screen.findByTestId('posture-review-dialog')
    expect(dialog.getAttribute('data-boundary')).toBe('collective_post_v1')
    expect(dialog.getAttribute('data-mode')).toBe('review')
  })

  it('the AI cloud line does NOT mount any disclosure when pressed (Boundary B is not wired — it renders null / dev-warns)', async () => {
    render(React.createElement(PrivacyCenterScreen))
    const aiLine = await screen.findByTestId('posture-ai-cloud')
    fireEvent.click(aiLine)

    expect(screen.queryByTestId('posture-review-dialog')).toBeNull()
  })

  it('the AI cloud line carries no button role and is not part of the tab order (static, non-focusable text — never a disabled control)', async () => {
    render(React.createElement(PrivacyCenterScreen))
    const aiLine = await screen.findByTestId('posture-ai-cloud')

    expect(aiLine.getAttribute('role')).not.toBe('button')
    expect(aiLine.getAttribute('aria-disabled')).toBeNull()
    expect(aiLine.hasAttribute('tabindex')).toBe(false)
  })
})

describe('v2 — export affordances placement', () => {
  it('mounts ExportJournal unconditionally, including for an anonymous/local-only session', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('export-journal-mock')).toBeTruthy()
  })

  it('mounts ExportJournal for an authenticated session too', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('export-journal-mock')).toBeTruthy()
  })

  it('mounts ExportCollectivePosts for an authenticated session', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('export-collective-posts-mock')).toBeTruthy()
  })

  it('does NOT mount ExportCollectivePosts for an anonymous session', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    render(React.createElement(PrivacyCenterScreen))

    // Wait for the staggered reveal to finish settling before asserting an
    // absence, so this isn't just "hasn't rendered yet".
    await screen.findByTestId('export-journal-mock')
    expect(screen.queryByTestId('export-collective-posts-mock')).toBeNull()
  })
})

describe('v2 — delete account entry (auth-gated trigger, always-mounted dialog)', () => {
  it('shows the Delete account entry trigger for an authenticated session', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('delete-account-entry')).toBeTruthy()
  })

  it('hides the Delete account entry trigger for an anonymous session (anonymous users have no account to delete)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    render(React.createElement(PrivacyCenterScreen))

    await screen.findByTestId('export-journal-mock')
    expect(screen.queryByTestId('delete-account-entry')).toBeNull()
  })

  it('keeps the <DeleteAccountFlow> dialog mounted regardless of auth (entry-only gating, never the Dialog itself)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('delete-account-flow-mock')).toBeTruthy()
  })

  it('mounts <DeleteAccountFlow> closed until the entry trigger is pressed, then opens it', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    render(React.createElement(PrivacyCenterScreen))

    const flow = await screen.findByTestId('delete-account-flow-mock')
    expect(flow.getAttribute('data-open')).toBe('false')

    fireEvent.click(await screen.findByTestId('delete-account-entry'))

    expect(screen.getByTestId('delete-account-flow-mock').getAttribute('data-open')).toBe('true')
  })
})

describe('v2 — staggered reveal completeness (every new section actually renders, not just the count constant)', () => {
  it('reveals every v1 AND v2 section once the stagger completes for an authenticated session', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    render(React.createElement(PrivacyCenterScreen))

    // Carryover v1 sections, still present.
    expect((await screen.findAllByText('Strict Privacy Mode')).length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('What We Can & Cannot Access')).toBeTruthy()
    expect(await screen.findByText('Data Retention & Deletion')).toBeTruthy()

    // New v2 posture section — all three lines.
    expect(
      await screen.findByText(
        "Your journal entries are encrypted on your device before they ever sync. We can't read them."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Posts you make in the Collective are stored as plain text on our servers. They are visible to other Collective members.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "When AI Reflection ships in a future release, you'll be able to choose between local inference (your writing never leaves your device) or cloud inference (sent to a named provider with a no-training commitment)."
      )
    ).toBeTruthy()

    // New v2 data-rights section — both export affordances.
    expect(await screen.findByTestId('export-journal-mock')).toBeTruthy()
    expect(await screen.findByTestId('export-collective-posts-mock')).toBeTruthy()

    // New v2 deletion entry, adjacent to Data Retention & Deletion.
    expect(await screen.findByTestId('delete-account-entry')).toBeTruthy()
  })
})

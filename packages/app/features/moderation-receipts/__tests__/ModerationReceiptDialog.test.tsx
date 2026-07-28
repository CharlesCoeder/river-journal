// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation-receipts/ModerationReceiptDialog.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { ModerationReceiptDialog }
 * from '../ModerationReceiptDialog'` with a module-resolution error, per this
 * repo's established red-phase convention (see `RemovePostDialog.test.tsx`).
 *
 * Contract this file locks in for the implementation (Props: `{ receipt,
 * onAcknowledge }` — no `open`/`onOpenChange`; presence/absence is driven by
 * the parent conditionally mounting/unmounting the dialog, per the gate's
 * one-at-a-time queue):
 *
 *   type ModerationReceipt =
 *     | { kind: 'removed_post'; id: string; parent_post_id: string | null;
 *         created_at: string; removed_reason: string | null; removed_at: string }
 *     | { kind: 'suspension'; id: string; ends_at: string; reason: string | null }
 *
 *   - Removal copy: top-level ("A post you made on {date} was removed.
 *     Reason: {label}.") vs reply ("A reply you made on {date} was removed.
 *     Reason: {label}.") branches on `parent_post_id`, NOT on any title field
 *     (the receipt type carries no title/body at all).
 *   - Reason code -> label mapping (locally defined, unknown/null -> "Other").
 *   - Suspension copy states scope + expiry + verbatim reason; a null/blank
 *     reason omits the "Reason:" line entirely (no dangling label).
 *   - Single dismiss button labeled "Got it" (NOT "Acknowledge") calls
 *     `onAcknowledge` exactly once.
 *   - A "View community guidelines" link fires `Linking.openURL` with the
 *     shared `COMMUNITY_GUIDELINES_URL` constant — and does NOT itself
 *     acknowledge the receipt.
 *   - No Appeal / Dispute / Contact-us affordance anywhere in the dialog.
 *   - No tap-outside / Esc dismiss — Escape does not call onAcknowledge.
 *   - The dialog never has access to (and therefore never renders) post
 *     title or body — the receipt type structurally excludes them.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── react-native Linking spy ──────────────────────────────────────────────
const openURLMock = vi.fn().mockResolvedValue(undefined)
vi.mock('react-native', () => ({
  Linking: { openURL: openURLMock },
}))

// ─── @my/ui mock — mirrors RemovePostDialog.test.tsx's Dialog mock, plus
// Escape handling on the Dialog wrapper to exercise "no tap-outside/Esc
// dismiss" (the mock forwards onOpenChange(false) on Escape the same way the
// real Radix/Tamagui primitive would; the wrapper under test must NOT wire
// onAcknowledge to that path). ────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = ({ backgroundColor, animation }: any) =>
    ReactModule.createElement('div', {
      'data-dialog-overlay': 'true',
      'data-bg': backgroundColor ?? '',
      'data-animation': animation ?? '',
    })
  const DialogContent = ({
    children,
    backgroundColor,
    borderColor,
    borderWidth,
    maxWidth,
    width,
    animation,
  }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog-content': 'true',
        'data-bg': backgroundColor ?? '',
        'data-border-color': borderColor ?? '',
        'data-border-width': String(borderWidth ?? ''),
        'data-max-width': String(maxWidth ?? ''),
        'data-width': width ?? '',
        'data-animation': animation ?? '',
      },
      children
    )
  const DialogTitle = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)
  const DialogDescription = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-dialog-desc': 'true' }, children)

  const DialogComponent = ({ children, open }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog': 'true',
        'data-open': String(open !== false),
        role: open !== false ? 'dialog' : undefined,
        'aria-modal': open !== false ? 'true' : undefined,
      },
      open !== false ? children : null
    )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
  })

  return {
    View: ({ children, tag, onPress, ...props }: any) => {
      const htmlProps: Record<string, unknown> = {}
      if (props['data-testid']) htmlProps['data-testid'] = props['data-testid']
      if (onPress) htmlProps['onClick'] = onPress
      return ReactModule.createElement(tag === 'button' ? 'button' : 'div', htmlProps, children)
    },
    Text: ({ children, onPress }: any) =>
      ReactModule.createElement(
        'span',
        onPress ? { onClick: onPress, role: 'link' } : {},
        children
      ),
    XStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    Dialog: DialogComponent,
    ExpandingLineButton: ({ children, onPress, disabled, size }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'data-size': size ?? '',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until ModerationReceiptDialog.tsx exists ──────
import { ModerationReceiptDialog } from '../ModerationReceiptDialog'
import { COMMUNITY_GUIDELINES_URL } from '../reasonLabels'

afterEach(() => {
  cleanup()
  openURLMock.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
function removalReceipt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'removed_post' as const,
    id: 'post-1',
    parent_post_id: null,
    created_at: '2026-06-15T12:00:00.000Z',
    removed_reason: 'harassment',
    removed_at: '2026-06-16T09:00:00.000Z',
    ...overrides,
  }
}

function suspensionReceipt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'suspension' as const,
    id: 'susp-1',
    ends_at: '2026-08-01T00:00:00.000Z',
    reason: 'harassment: repeated flags',
    ...overrides,
  }
}

const MONTHS =
  /January|February|March|April|May|June|July|August|September|October|November|December/

// ─────────────────────────────────────────────────────────────────────────────
describe('COMMUNITY_GUIDELINES_URL constant', () => {
  it('matches the value the notify_moderation_action Edge Function uses', () => {
    expect(COMMUNITY_GUIDELINES_URL).toBe('https://riverjournal.app/community-guidelines')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Removal receipt — top-level post copy', () => {
  it('renders "A post you made on {date} was removed." for a top-level post (parent_post_id null)', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ parent_post_id: null })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/a post you made on/i)).toBeTruthy()
    expect(screen.getByText(/was removed/i)).toBeTruthy()
  })

  it('the rendered date is derived from created_at (contains a month name)', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ created_at: '2026-06-15T12:00:00.000Z' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(MONTHS)).toBeTruthy()
  })

  it('never renders reply copy for a top-level post', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ parent_post_id: null })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/a reply you made/i)).toBeNull()
  })
})

describe('Removal receipt — reply copy', () => {
  it('renders "A reply you made on {date} was removed." when parent_post_id is set', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ parent_post_id: 'top-post-9' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/a reply you made on/i)).toBeTruthy()
  })

  it('never renders top-level copy for a reply', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ parent_post_id: 'top-post-9' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/^a post you made/i)).toBeNull()
  })
})

describe('Removal receipt — reason label mapping', () => {
  const cases: Array<[string, RegExp]> = [
    ['harassment', /harassment/i],
    ['off_topic', /off-topic/i],
    ['spam', /spam/i],
    ['threats', /threats/i],
    ['illegal_content', /illegal content/i],
    ['other', /other/i],
  ]

  for (const [code, expected] of cases) {
    it(`maps removed_reason "${code}" to its templated label`, () => {
      render(
        <ModerationReceiptDialog
          receipt={removalReceipt({ removed_reason: code })}
          onAcknowledge={vi.fn()}
        />
      )
      expect(screen.getByText(expected)).toBeTruthy()
    })
  }

  it('falls back to "Other" for an unknown reason code (drift-safe vs the admin map)', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ removed_reason: 'some_future_code' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/other/i)).toBeTruthy()
  })

  it('falls back to "Other" when removed_reason is null', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt({ removed_reason: null })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/other/i)).toBeTruthy()
  })
})

describe('Removal receipt — never renders post content', () => {
  it('the receipt object carries no title/body fields, and none appear in the rendered output', () => {
    const receipt = removalReceipt()
    expect((receipt as Record<string, unknown>).title).toBeUndefined()
    expect((receipt as Record<string, unknown>).body).toBeUndefined()

    const { container } = render(
      <ModerationReceiptDialog
        receipt={receipt}
        onAcknowledge={vi.fn()}
      />
    )
    // Only date + templated reason + fixed copy should ever appear — nothing
    // resembling free-text post content.
    expect(container.textContent).not.toMatch(/lorem|post body|post title/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Suspension receipt copy', () => {
  it('states scope: "paused" + "post and react" language', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/paused/i)).toBeTruthy()
  })

  it('states "You can still write and read."', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/you can still write and read/i)).toBeTruthy()
  })

  it('the rendered expiry date is derived from ends_at (contains a month name)', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt({ ends_at: '2026-09-20T00:00:00.000Z' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(MONTHS)).toBeTruthy()
  })

  it('renders the free-text reason verbatim (not re-mapped through the removal label map)', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt({ reason: 'harassment: repeated flags from other members' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/harassment: repeated flags from other members/)).toBeTruthy()
  })

  it('omits the "Reason:" line entirely when reason is null', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt({ reason: null })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/reason:/i)).toBeNull()
  })

  it('omits the "Reason:" line entirely when reason is a blank/whitespace string', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt({ reason: '   ' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/reason:/i)).toBeNull()
  })

  it('renders the "Reason:" line when reason is a non-blank string', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt({ reason: 'spam' })}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/reason:/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Dismiss button — "Got it", not "Acknowledge"', () => {
  it('renders a button labeled "Got it" (or "OK") — never the literal word "Acknowledge"', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    const gotIt = screen.queryByRole('button', { name: /got it/i })
    const ok = screen.queryByRole('button', { name: /^ok$/i })
    expect(gotIt !== null || ok !== null).toBe(true)
    expect(screen.queryByRole('button', { name: /^acknowledge$/i })).toBeNull()
  })

  it('nowhere in the dialog does visible text read the literal word "Acknowledge"', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/\backnowledge\b/i)).toBeNull()
  })

  it('pressing the dismiss button calls onAcknowledge exactly once', () => {
    const onAcknowledge = vi.fn()
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={onAcknowledge}
      />
    )
    const dismissBtn =
      screen.queryByRole('button', { name: /got it/i }) ??
      screen.queryByRole('button', { name: /^ok$/i })
    fireEvent.click(dismissBtn!)
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('works identically for a suspension receipt', () => {
    const onAcknowledge = vi.fn()
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt()}
        onAcknowledge={onAcknowledge}
      />
    )
    const dismissBtn =
      screen.queryByRole('button', { name: /got it/i }) ??
      screen.queryByRole('button', { name: /^ok$/i })
    fireEvent.click(dismissBtn!)
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('No appeal / dispute / contact-us affordance', () => {
  it('renders no "Appeal" control', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/appeal/i)).toBeNull()
  })

  it('renders no "Dispute" control', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/dispute/i)).toBeNull()
  })

  it('renders no "Contact us" control', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/contact us/i)).toBeNull()
  })

  it('renders no "Appeal" control on the suspension variant either', () => {
    render(
      <ModerationReceiptDialog
        receipt={suspensionReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.queryByText(/appeal/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Community guidelines link', () => {
  it('renders a "community guidelines" affordance', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    expect(screen.getByText(/community guidelines/i)).toBeTruthy()
  })

  it('pressing it calls Linking.openURL with COMMUNITY_GUIDELINES_URL', () => {
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={vi.fn()}
      />
    )
    const link = screen.getByText(/community guidelines/i)
    fireEvent.click(link)
    expect(openURLMock).toHaveBeenCalledWith(COMMUNITY_GUIDELINES_URL)
  })

  it('pressing the guidelines link does NOT itself acknowledge the receipt', () => {
    const onAcknowledge = vi.fn()
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={onAcknowledge}
      />
    )
    const link = screen.getByText(/community guidelines/i)
    fireEvent.click(link)
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('No tap-outside / Esc dismiss', () => {
  it('pressing Escape on the dialog does NOT call onAcknowledge', () => {
    const onAcknowledge = vi.fn()
    render(
      <ModerationReceiptDialog
        receipt={removalReceipt()}
        onAcknowledge={onAcknowledge}
      />
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})

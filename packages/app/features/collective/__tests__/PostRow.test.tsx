// @vitest-environment happy-dom
/**
 * Unit tests for `features/collective/PostRow.tsx`.
 *
 * Focus: the screen-reader (aria-label) must NEVER carry post body/excerpt text
 * for deleted posts — neither self-deleted (is_user_deleted) nor anonymized
 * (user_id === null). This closes the 3-15 a11y review finding, including the
 * transient optimistic-delete window where `excerpt` stays intact.
 *
 * Mock strategy: child components (ReactionStrip, FlagAffordance, AuthorByline)
 * are stubbed; @my/ui primitives map to testable HTML elements that surface
 * aria-label. Mirrors ReactionStrip.test.tsx / ThreadView.test.tsx patterns.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// ─── child component stubs ────────────────────────────────────────────────────
vi.mock('app/features/collective/ReactionStrip', () => ({
  ReactionStrip: () => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'reaction-strip' })
  },
}))

vi.mock('app/features/collective/FlagAffordance', () => ({
  FlagAffordance: () => {
    const React = require('react')
    return React.createElement('button', { 'data-testid': 'flag-affordance' })
  },
}))

// ─── @my/ui mock — map primitives to HTML, surfacing aria-label ───────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  return {
    View: ({ children, tag, role, 'aria-label': ariaLabel, ...props }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (role) a11y['role'] = role
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      return ReactModule.createElement(htmlTag, a11y, children)
    },
    Text: ({ children }: any) => ReactModule.createElement('span', null, children),
    XStack: ({ children }: any) => ReactModule.createElement('div', null, children),
    AuthorByline: ({ displayName, deletedDisplay }: any) =>
      ReactModule.createElement(
        'span',
        {
          'data-testid': 'author-byline',
          'data-deleted-display': deletedDisplay ? 'true' : 'false',
        },
        deletedDisplay ? '[deleted]' : displayName
      ),
  }
})

// eslint-disable-next-line import/first
import { PostRow } from '../PostRow'

// ─── fixture ──────────────────────────────────────────────────────────────────
function buildPost(overrides: Partial<any> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: 'user-abcdef12',
    parent_post_id: null,
    title: 'A title',
    excerpt: 'Secret confession that should never reach a screen reader once deleted.',
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    descendant_count: 0,
    reactions: {},
    mode: 'full' as const,
    ...overrides,
  }
}

const SECRET = 'Secret confession'

afterEach(cleanup)

describe('PostRow a11y label', () => {
  it('includes the excerpt for a normal post', () => {
    const { container } = render(
      React.createElement(PostRow, { post: buildPost(), currentUserId: 'user-abcdef12' })
    )
    const article = container.querySelector('article')
    expect(article?.getAttribute('aria-label')).toContain(SECRET)
  })

  it('does NOT carry excerpt text when the post is self-deleted', () => {
    const { container } = render(
      React.createElement(PostRow, {
        post: buildPost({ is_user_deleted: true }),
        currentUserId: 'user-abcdef12',
      })
    )
    const article = container.querySelector('article')
    const label = article?.getAttribute('aria-label') ?? ''
    expect(label).not.toContain(SECRET)
    expect(label).toBe('[deleted]')
  })

  it('does NOT carry excerpt text when the post is anonymized (user_id null)', () => {
    const { container } = render(
      React.createElement(PostRow, {
        post: buildPost({ user_id: null }),
        currentUserId: 'user-abcdef12',
      })
    )
    const article = container.querySelector('article')
    const label = article?.getAttribute('aria-label') ?? ''
    expect(label).not.toContain(SECRET)
    expect(label).toBe('[deleted]')
  })
})

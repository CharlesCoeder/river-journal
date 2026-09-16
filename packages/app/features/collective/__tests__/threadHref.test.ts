import { afterEach, describe, expect, it, vi } from 'vitest'
import { threadHref } from '../threadHref'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('threadHref — web and mobile (dynamic path segment)', () => {
  it('addresses a thread by path segment', () => {
    expect(threadHref('abc-123')).toBe('/collective/thread/abc-123')
  })

  it('carries focusedFromRoot as a query param', () => {
    expect(threadHref('reply-1', { focusedFromRoot: 'root-9' })).toBe(
      '/collective/thread/reply-1?focusedFromRoot=root-9'
    )
  })

  it('a null focusedFromRoot adds no query string', () => {
    expect(threadHref('abc', { focusedFromRoot: null })).toBe('/collective/thread/abc')
  })
})

describe('threadHref — desktop static export (fixed page + query string)', () => {
  it('addresses a thread by query string so the static export needs no per-id file', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', 'true')
    expect(threadHref('abc-123')).toBe('/collective/thread?postId=abc-123')
  })

  it('carries focusedFromRoot alongside postId', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', 'true')
    expect(threadHref('reply-1', { focusedFromRoot: 'root-9' })).toBe(
      '/collective/thread?postId=reply-1&focusedFromRoot=root-9'
    )
  })

  it('URL-encodes the id rather than trusting it', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', 'true')
    expect(threadHref('a b&c')).toBe('/collective/thread?postId=a+b%26c')
  })

  it('any value other than the literal "true" keeps the path form', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', '1')
    expect(threadHref('abc')).toBe('/collective/thread/abc')
  })
})

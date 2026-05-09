/**
 * eligibility.ts — TanStack Query hook test.
 *
 * Verifies:
 *   - useEligibleToPost calls supabase.rpc('is_eligible_to_post')
 *   - returns boolean from RPC
 *   - exposes isError when the RPC fails
 *   - queryKey is ['collective', 'eligibility']
 *   - staleTime is 25_000
 *   - refetchOnWindowFocus is true
 *   - file is D7-clean (no @legendapp/state imports)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const ELIGIBILITY_PATH = path.join(COLLECTIVE_DIR, 'eligibility.ts')

const { rpcMock } = vi.hoisted(() => {
  const rpcMock = vi.fn()
  return { rpcMock }
})

vi.mock('../../../utils/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

beforeEach(() => {
  rpcMock.mockReset()
  useQueryMock.mockReset()
})

describe('eligibility.ts existence + D7 compliance', () => {
  it('eligibility.ts exists', () => {
    expect(existsSync(ELIGIBILITY_PATH)).toBe(true)
  })

  it('eligibility.ts does NOT import @legendapp/state (D7)', () => {
    const src = readFileSync(ELIGIBILITY_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('eligibility.ts does NOT import from app/state/store (D7)', () => {
    const src = readFileSync(ELIGIBILITY_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})

describe('useEligibleToPost — RPC wiring', () => {
  it('queryFn calls supabase.rpc("is_eligible_to_post") and returns boolean', async () => {
    useQueryMock.mockReturnValue({
      data: true,
      isLoading: false,
      isError: false,
    })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()

    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const result = await opts.queryFn()
    expect(rpcMock).toHaveBeenCalledWith('is_eligible_to_post')
    expect(result).toBe(true)
  })

  it('queryFn coerces RPC value to boolean (false stays false)', async () => {
    useQueryMock.mockReturnValue({ data: false, isLoading: false, isError: false })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()
    const opts = useQueryMock.mock.calls[0]![0]
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    expect(await opts.queryFn()).toBe(false)
  })

  it('queryFn rejects when RPC returns an error', async () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()
    const opts = useQueryMock.mock.calls[0]![0]
    const pgError = { message: 'permission denied', code: '42501' }
    rpcMock.mockResolvedValueOnce({ data: null, error: pgError })
    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})

describe('useEligibleToPost — query options', () => {
  it('queryKey is ["collective", "eligibility"]', async () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['collective', 'eligibility'])
  })

  it('staleTime is 25_000', async () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(25_000)
  })

  it('refetchOnWindowFocus is true', async () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    const { useEligibleToPost } = await import('../eligibility')
    useEligibleToPost()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.refetchOnWindowFocus).toBe(true)
  })
})

describe('useEligibleToPost — return shape', () => {
  it('exposes data, isLoading, isError, query', async () => {
    useQueryMock.mockReturnValue({
      data: true,
      isLoading: false,
      isError: false,
    })
    const { useEligibleToPost } = await import('../eligibility')
    const result = useEligibleToPost()
    expect(result.data).toBe(true)
    expect(result.isLoading).toBe(false)
    expect(result.isError).toBe(false)
    expect(result.query).toBeDefined()
  })

  it('isError is true when query errored with no cache', async () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    const { useEligibleToPost } = await import('../eligibility')
    const result = useEligibleToPost()
    expect(result.isError).toBe(true)
    expect(result.data).toBeUndefined()
  })
})

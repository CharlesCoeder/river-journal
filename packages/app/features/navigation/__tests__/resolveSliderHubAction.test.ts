// @vitest-environment happy-dom
/**
 * Route-aware hub contract: home opens spokes, each spoke closes with the
 * opposite slide, everything else is inert. The two gestures never gain a
 * third meaning.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HUB_SPOKES,
  normalizeHubPathname,
  resolveSliderHubAction,
  sliderHubDirections,
  type HubSpoke,
} from '../sliderHubUtils'

describe('normalizeHubPathname', () => {
  it('keeps the root and strips trailing slashes elsewhere', () => {
    expect(normalizeHubPathname('/')).toBe('/')
    expect(normalizeHubPathname('/menu/')).toBe('/menu')
    expect(normalizeHubPathname('/journal')).toBe('/journal')
    expect(normalizeHubPathname(null)).toBe('/')
    expect(normalizeHubPathname(undefined)).toBe('/')
  })
})

describe('resolveSliderHubAction — home', () => {
  it('slide right opens the editor', () => {
    expect(resolveSliderHubAction('/', 'right')).toEqual({ type: 'push', route: '/journal' })
  })
  it('slide left opens the menu', () => {
    expect(resolveSliderHubAction('/', 'left')).toEqual({ type: 'push', route: '/menu' })
  })
  it('snap-back stays put', () => {
    expect(resolveSliderHubAction('/', 'snap-back')).toEqual({ type: 'snap-back' })
  })
})

describe('resolveSliderHubAction — spokes return with the opposite slide', () => {
  it('on the menu (opened by slide left) slide right goes back', () => {
    expect(resolveSliderHubAction('/menu', 'right')).toEqual({ type: 'back' })
  })
  it('on the menu slide left does nothing — never the editor', () => {
    expect(resolveSliderHubAction('/menu', 'left')).toEqual({ type: 'snap-back' })
  })
  it('on the editor (opened by slide right) slide left goes back', () => {
    expect(resolveSliderHubAction('/journal', 'left')).toEqual({ type: 'back' })
  })
  it('on the editor slide right does nothing — never the menu', () => {
    expect(resolveSliderHubAction('/journal', 'right')).toEqual({ type: 'snap-back' })
  })
  it('tolerates a trailing slash on the spoke route', () => {
    expect(resolveSliderHubAction('/menu/', 'right')).toEqual({ type: 'back' })
  })
})

describe('resolveSliderHubAction — other routes are inert', () => {
  it.each(['/settings', '/day-view', '/collective', '/journal/celebration', '/auth'])(
    '%s snaps back in both directions',
    (route) => {
      expect(resolveSliderHubAction(route, 'right')).toEqual({ type: 'snap-back' })
      expect(resolveSliderHubAction(route, 'left')).toEqual({ type: 'snap-back' })
    }
  )
})

describe('sliderHubDirections', () => {
  it('home allows both directions with the default spokes', () => {
    expect(sliderHubDirections('/')).toEqual({ right: true, left: true })
  })
  it('a spoke allows only its return direction', () => {
    expect(sliderHubDirections('/menu')).toEqual({ right: true, left: false })
    expect(sliderHubDirections('/journal')).toEqual({ right: false, left: true })
  })
  it('other routes allow nothing', () => {
    expect(sliderHubDirections('/settings')).toEqual({ right: false, left: false })
  })
  it('honours a reduced spoke set (menu only)', () => {
    const menuOnly: HubSpoke[] = [{ route: '/menu', open: 'left' }]
    expect(sliderHubDirections('/', menuOnly)).toEqual({ right: false, left: true })
    expect(resolveSliderHubAction('/', 'right', menuOnly)).toEqual({ type: 'snap-back' })
    expect(resolveSliderHubAction('/', 'left', menuOnly)).toEqual({ type: 'push', route: '/menu' })
    expect(resolveSliderHubAction('/menu', 'right', menuOnly)).toEqual({ type: 'back' })
    expect(resolveSliderHubAction('/journal', 'left', menuOnly)).toEqual({ type: 'snap-back' })
  })
  it('the defaults are the v2 model', () => {
    expect(DEFAULT_HUB_SPOKES).toEqual([
      { route: '/journal', open: 'right' },
      { route: '/menu', open: 'left' },
    ])
  })
})

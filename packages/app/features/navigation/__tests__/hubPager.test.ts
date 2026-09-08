/**
 * Hub pager geometry — pure helpers that place the panes and turn a drag or a
 * committed slide into a track position / destination pane.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HUB_SPOKES,
  hubPagerDestination,
  hubPagerDragX,
  hubPagerTargetX,
  hubPaneSlot,
} from '../sliderHubUtils'

const W = 400
const BOTH = { right: true, left: true }
const LEFT_ONLY = { right: false, left: true }
const RIGHT_ONLY = { right: true, left: false }

describe('hubPaneSlot — where each pane sits relative to home', () => {
  it('home is the centre', () => {
    expect(hubPaneSlot('/')).toBe(0)
  })
  it('a spoke opened by sliding right lives to the LEFT of home', () => {
    expect(hubPaneSlot('/journal')).toBe(-1)
  })
  it('a spoke opened by sliding left lives to the RIGHT of home', () => {
    expect(hubPaneSlot('/menu')).toBe(1)
  })
  it('normalises a trailing slash', () => {
    expect(hubPaneSlot('/menu/')).toBe(1)
  })
  it('anything that is not a spoke sits with home', () => {
    expect(hubPaneSlot('/settings')).toBe(0)
    expect(hubPaneSlot(null)).toBe(0)
  })
  it('follows a custom spoke table', () => {
    expect(hubPaneSlot('/menu', [{ route: '/menu', open: 'right' }])).toBe(-1)
    expect(hubPaneSlot('/journal', [{ route: '/menu', open: 'right' }])).toBe(0)
  })
})

describe('hubPagerTargetX — the resting translateX that shows a pane', () => {
  it('home rests at 0', () => {
    expect(hubPagerTargetX('/', DEFAULT_HUB_SPOKES, W)).toBe(0)
  })
  it('the left-hand pane needs the track moved right by one width', () => {
    expect(hubPagerTargetX('/journal', DEFAULT_HUB_SPOKES, W)).toBe(W)
  })
  it('the right-hand pane needs the track moved left by one width', () => {
    expect(hubPagerTargetX('/menu', DEFAULT_HUB_SPOKES, W)).toBe(-W)
  })
})

describe('hubPagerDragX — following the finger within the panes that exist', () => {
  it('follows the finger from rest in either allowed direction', () => {
    expect(hubPagerDragX(0, 120, 0, BOTH, W)).toBe(120)
    expect(hubPagerDragX(0, -120, 0, BOTH, W)).toBe(-120)
  })
  it('never travels further than one pane', () => {
    expect(hubPagerDragX(0, 900, 0, BOTH, W)).toBe(W)
    expect(hubPagerDragX(0, -900, 0, BOTH, W)).toBe(-W)
  })
  it('ignores a direction that means nothing on this pane', () => {
    expect(hubPagerDragX(0, 120, 0, LEFT_ONLY, W)).toBe(0)
    expect(hubPagerDragX(0, -120, 0, RIGHT_ONLY, W)).toBe(0)
  })
  it('on a spoke, only moves back toward home', () => {
    // Journal rests at +W; only finger-left (toward home) does anything.
    expect(hubPagerDragX(W, -150, W, LEFT_ONLY, W)).toBe(W - 150)
    expect(hubPagerDragX(W, 150, W, LEFT_ONLY, W)).toBe(W)
    expect(hubPagerDragX(W, -900, W, LEFT_ONLY, W)).toBe(0)
  })
  it('a finger that lands mid-spring picks the track up where it is', () => {
    // Track is 100px into the menu slide when the finger lands and moves 50 further.
    expect(hubPagerDragX(-100, -50, 0, BOTH, W)).toBe(-150)
    // …and can be pulled back past rest only if that direction is allowed.
    expect(hubPagerDragX(-100, 300, 0, LEFT_ONLY, W)).toBe(0)
  })
})

describe('hubPagerDestination — where a committed slide lands', () => {
  it('home opens the spoke that slides in from that side', () => {
    expect(hubPagerDestination('/', 'right')).toBe('/journal')
    expect(hubPagerDestination('/', 'left')).toBe('/menu')
  })
  it('a spoke returns home on its reverse slide', () => {
    expect(hubPagerDestination('/journal', 'left')).toBe('/')
    expect(hubPagerDestination('/menu', 'right')).toBe('/')
  })
  it('the same slide that opened a spoke stays put on it', () => {
    expect(hubPagerDestination('/journal', 'right')).toBe('/journal')
    expect(hubPagerDestination('/menu', 'left')).toBe('/menu')
  })
  it('a snap-back stays put anywhere', () => {
    expect(hubPagerDestination('/', 'snap-back')).toBe('/')
    expect(hubPagerDestination('/menu', 'snap-back')).toBe('/menu')
  })
  it('an unknown pane stays put', () => {
    expect(hubPagerDestination('/settings', 'left')).toBe('/settings')
  })
})

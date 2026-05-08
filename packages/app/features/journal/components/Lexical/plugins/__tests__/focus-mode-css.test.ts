// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS_PATH = join(__dirname, '..', '..', 'lexical-theme.css')
const UTILS_PATH = join(__dirname, '..', '..', 'utils.ts')

describe('focus-mode CSS specificity (regression: focus-toggle no-op)', () => {
  it('lexical-theme.css scopes .rj-focus-dim under .lex-root p / .lex-paragraph', () => {
    const css = readFileSync(CSS_PATH, 'utf8')
    expect(css).toMatch(/\.lex-root p\.rj-focus-dim/)
    expect(css).toMatch(/\.lex-paragraph\.rj-focus-dim/)
    expect(css).toMatch(/\.lex-root p\.rj-focus-active/)
    expect(css).toMatch(/\.lex-paragraph\.rj-focus-active/)
  })

  it('utils.ts injectFocusModeCSS mirrors the same compound selectors', () => {
    const src = readFileSync(UTILS_PATH, 'utf8')
    expect(src).toMatch(/\.lex-root p\.rj-focus-dim/)
    expect(src).toMatch(/\.lex-paragraph\.rj-focus-dim/)
    expect(src).toMatch(/\.lex-root p\.rj-focus-active/)
    expect(src).toMatch(/\.lex-paragraph\.rj-focus-active/)
  })

  it('computed opacity of .lex-root > p.rj-focus-dim is 0.4 (specificity beats all: revert)', () => {
    const css = readFileSync(CSS_PATH, 'utf8')
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.className = 'lex-root'
    const p = document.createElement('p')
    p.className = 'rj-focus-dim'
    p.textContent = 'dimmed paragraph'
    root.appendChild(p)
    document.body.appendChild(root)

    const computed = window.getComputedStyle(p)
    expect(computed.opacity).toBe('0.4')

    document.body.removeChild(root)
    document.head.removeChild(style)
  })

  it('computed opacity of .lex-root > p.rj-focus-active is 1', () => {
    const css = readFileSync(CSS_PATH, 'utf8')
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.className = 'lex-root'
    const p = document.createElement('p')
    p.className = 'rj-focus-active'
    root.appendChild(p)
    document.body.appendChild(root)

    expect(window.getComputedStyle(p).opacity).toBe('1')

    document.body.removeChild(root)
    document.head.removeChild(style)
  })
})

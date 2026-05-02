'use client'

/**
 * SkipToContent — visually hidden until focused a11y link.
 * Must be the FIRST child of <body> in the layout.
 *
 * When Tab is pressed from the page top, this link surfaces at
 * the top-left of the viewport. Activating it (Enter) moves
 * keyboard focus to the main content region (#main-content).
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        left: '-10000px',
        top: 'auto',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
      onFocus={(e) => {
        const el = e.currentTarget
        Object.assign(el.style, {
          position: 'fixed',
          top: '8px',
          left: '8px',
          width: 'auto',
          height: 'auto',
          padding: '8px 16px',
          background: 'var(--background, #fff)',
          color: 'var(--color, #000)',
          zIndex: '9999',
          overflow: 'visible',
        })
      }}
      onBlur={(e) => {
        const el = e.currentTarget
        Object.assign(el.style, {
          position: 'absolute',
          left: '-10000px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        })
      }}
    >
      Skip to content
    </a>
  )
}

export default SkipToContent

import { expect } from 'vitest'

// Extend vitest with a minimal set of DOM matchers needed by tests.
// This replaces @testing-library/jest-dom which is not installed.
expect.extend({
  toBeDisabled(element: HTMLElement) {
    const isDisabled =
      element.hasAttribute('disabled') ||
      (element as HTMLButtonElement).disabled === true ||
      element.getAttribute('aria-disabled') === 'true'
    return {
      pass: isDisabled,
      message: () =>
        isDisabled
          ? `expected element not to be disabled`
          : `expected element to be disabled`,
    }
  },
})

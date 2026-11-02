/**
 * Minimal stub for @tamagui/tailwind in Vitest. Renders plain elements, honoring
 * `render`, and exposes className and transition so tests can assert on them.
 */
import { createElement, forwardRef } from 'react'

const make = (fallback: string) =>
  forwardRef<any, any>(function TailwindStub(
    { children, render, className, testID, transition, onPress, style, ...rest },
    ref
  ) {
    return createElement(
      typeof render === 'string' ? render : fallback,
      {
        ...rest,
        ref,
        style,
        className,
        ...(testID !== undefined ? { 'data-testid': testID } : {}),
        ...(transition !== undefined ? { 'data-transition': String(transition) } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children
    )
  })

export const View = make('div')
export const Text = make('span')

/**
 * Core types for state management
 */

// Demo state type for our demo feature
export interface DemoState {
  counter: number
  text: string
  lastUpdated: string | null
  toggleState: boolean
}

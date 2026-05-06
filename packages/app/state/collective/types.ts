// packages/app/state/collective/types.ts
//
// Boundary rule (D7): MUST NOT import @legendapp/state.
//
// Shared types for the collective reaction system. This file exists as the
// single source of truth for ReactionKind and related types, breaking the
// circular dependency that would otherwise emerge between mutations.ts and
// reactions.ts.

// The reaction icon set is locked: Heart, Sparkles, Flame, Leaf, Waves.
// The DB-level `kind` column is TEXT (permissive), but we narrow here to
// prevent unintentional values from the call site.
export type ReactionKind = 'heart' | 'sparkle' | 'flame' | 'leaf' | 'wave'

export type ToggleReactionVars = {
  id: string
  post_id: string
  kind: ReactionKind
  user_id: string
  toggle: 'add' | 'remove'
}

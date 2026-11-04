// Tamagui 3 only publishes this entry through package exports, which this repo's
// classic TypeScript module resolution cannot read. Node and bundlers resolve it fine.
declare module '@tamagui/config/v5' {
  export * from '@tamagui/config/types/v5'
}

import { createAnimations } from '@tamagui/animations-react-native'
import { animationsReactNative } from '@tamagui/config/v5-rn'

export const animations = createAnimations({
  ...animationsReactNative.animations,
  '100ms': {
    type: 'timing',
    duration: 100,
  },
  bouncy: {
    damping: 9,
    mass: 0.9,
    stiffness: 150,
  },
  lazy: {
    damping: 18,
    stiffness: 50,
  },
  medium: {
    damping: 15,
    stiffness: 120,
    mass: 1,
  },
  slow: {
    damping: 15,
    stiffness: 40,
  },
  quick: {
    damping: 20,
    mass: 1.2,
    stiffness: 250,
  },
  tooltip: {
    damping: 10,
    mass: 0.9,
    stiffness: 100,
  },
  designEnter: {
    damping: 20,
    stiffness: 80,
    mass: 1,
  },
  designEnterSlow: {
    damping: 22,
    stiffness: 50,
    mass: 1,
  },
  designEnterVerySlow: {
    damping: 24,
    stiffness: 35,
    mass: 1,
  },
  designModal: {
    damping: 20,
    stiffness: 100,
    mass: 1,
  },
  designModalExit: {
    type: 'timing',
    duration: 400,
  },
  ctaSpring: {
    stiffness: 400,
    damping: 30,
  },
  celebrationSpring: {
    stiffness: 40,
    damping: 20,
  },
})

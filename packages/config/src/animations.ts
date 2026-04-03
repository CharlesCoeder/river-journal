import { createAnimations } from '@tamagui/animations-motion'
import { animationsMotion } from '@tamagui/config/v5-motion'

export const animations = createAnimations({
  ...animationsMotion.animations,
  '100ms': {
    type: 'tween',
    duration: 0.1,
  },
  bouncy: {
    type: 'spring',
    damping: 9,
    mass: 0.9,
    stiffness: 150,
  },
  lazy: {
    type: 'spring',
    damping: 18,
    stiffness: 50,
  },
  medium: {
    type: 'spring',
    damping: 15,
    stiffness: 120,
    mass: 1,
  },
  slow: {
    type: 'spring',
    damping: 15,
    stiffness: 40,
  },
  quick: {
    type: 'spring',
    damping: 20,
    mass: 1.2,
    stiffness: 250,
  },
  tooltip: {
    type: 'spring',
    damping: 10,
    mass: 0.9,
    stiffness: 100,
  },
  designEnter: {
    type: 'spring',
    stiffness: 120,
    damping: 18,
    mass: 1,
  },
  designEnterSlow: {
    type: 'spring',
    stiffness: 60,
    damping: 18,
    mass: 1,
  },
  designEnterVerySlow: {
    type: 'spring',
    stiffness: 35,
    damping: 16,
    mass: 1,
  },
  designModal: {
    type: 'spring',
    stiffness: 180,
    damping: 22,
    mass: 1,
  },
  designModalExit: {
    type: 'spring',
    stiffness: 250,
    damping: 25,
    mass: 1,
  },
  ctaSpring: {
    type: 'spring',
    stiffness: 400,
    damping: 30,
  },
  celebrationSpring: {
    type: 'spring',
    stiffness: 40,
    damping: 20,
  },
})

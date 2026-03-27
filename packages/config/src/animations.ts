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
    type: 'tween',
    duration: 0.8,
    ease: [0.16, 1, 0.3, 1],
  },
  designEnterSlow: {
    type: 'tween',
    duration: 1.2,
    ease: [0.16, 1, 0.3, 1],
  },
  designEnterVerySlow: {
    type: 'tween',
    duration: 1.5,
    ease: [0.16, 1, 0.3, 1],
  },
  designModal: {
    type: 'tween',
    duration: 0.6,
    ease: [0.16, 1, 0.3, 1],
  },
  designModalExit: {
    type: 'tween',
    duration: 0.4,
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

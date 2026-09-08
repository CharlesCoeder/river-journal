import { InlineHomeScreen } from 'app/features/home/InlineHomeScreen'
import { HubPager } from 'app/features/navigation/HubPager'
import { MenuScreen } from 'app/features/navigation/MenuScreen'
import type { HubSpoke } from 'app/features/navigation/sliderHubUtils'
import { OnboardingGate } from 'app/features/onboarding/OnboardingGate'
import { ephemeral$ } from 'app/state/store'
import { use$ } from '@legendapp/state/react'
import { YStack } from '@my/ui'

/**
 * Inline-editor home: writing happens on the page itself, so there is no
 * editor spoke. The menu is the one spoke — it slides in from the right and
 * back out the same way — and the hub is switched off while the page is up
 * (writing mode), so a horizontal drag over text is never read as navigation.
 */
const INLINE_HOME_SPOKES: readonly HubSpoke[] = [{ route: '/menu', open: 'left' }]

export default function HomeRoute() {
  return (
    <YStack flex={1}>
      <OnboardingGate>
        <HubPanes />
      </OnboardingGate>
    </YStack>
  )
}

/**
 * Home is the writing surface AND the hub: the menu is mounted one pane to
 * the right, so a slide moves the real menu rather than an empty container
 * that a route fills in after the finger lifts. The editor overlay rides with
 * home. Everything deeper — settings, past entries, the celebration — is still
 * a stack push above the whole pager.
 */
function HubPanes() {
  const editorExpanded = use$(ephemeral$.persistentEditor.expanded)
  return (
    <HubPager
      spokes={INLINE_HOME_SPOKES}
      home={<InlineHomeScreen />}
      panes={{ '/menu': <MenuScreen /> }}
      enabled={!editorExpanded}
    />
  )
}

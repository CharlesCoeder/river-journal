import { AnimatePresence, ScrollView, Text, YStack, XStack, View } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useEffect, useState } from 'react'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { encryptionSetup$ } from 'app/state/encryptionSetup'
import { ExportJournal } from './components/ExportJournal'
import { ExportCollectivePosts } from './components/ExportCollectivePosts'
import { BackupRestore } from './components/BackupRestore'
import { DeleteAccountFlow } from './components/DeleteAccountFlow'
import { ThreePostureDisclosure } from 'app/features/disclosure/ThreePostureDisclosure'

function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={12}
      textTransform="uppercase"
      letterSpacing={2}
      color="$color8"
    >
      {children}
    </Text>
  )
}

function PrivacyModeCard({
  title,
  quote,
  bullets,
  isActive,
}: {
  title: string
  quote: string
  bullets: string[]
  isActive: boolean
}) {
  return (
    <YStack
      flex={1}
      padding="$6"
      borderWidth={1}
      borderColor={isActive ? '$color' : '$color2'}
      backgroundColor={isActive ? '$color1' : 'transparent'}
      borderRadius="$2"
    >
      <Text
        fontFamily="$journal"
        fontSize={20}
        color="$color"
        borderBottomWidth={1}
        borderColor="$color2"
        paddingBottom="$3"
        marginBottom="$4"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={12}
        color="$color8"
        fontStyle="italic"
        marginBottom="$4"
      >
        {quote}
      </Text>
      <YStack gap="$3">
        {bullets.map((bullet, i) => (
          <XStack
            key={i}
            gap="$2"
            alignItems="flex-start"
          >
            <Text
              fontFamily="$body"
              fontSize={14}
              color="$color7"
            >
              {'\u2022'}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={14}
              color="$color8"
              flex={1}
            >
              {bullet}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

function AccessRow({
  term,
  definition,
  showBorder = true,
}: {
  term: string
  definition: string
  showBorder?: boolean
}) {
  return (
    <XStack
      flexDirection="column"
      gap="$2"
      $md={{ flexDirection: 'row', gap: '$6' }}
      borderBottomWidth={showBorder ? 1 : 0}
      borderColor="$color2"
      paddingBottom={showBorder ? 24 : 0}
    >
      <Text
        fontFamily="$journal"
        fontSize={18}
        color="$color"
        $md={{ width: '33%' }}
        flexShrink={0}
      >
        {term}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$color8"
        lineHeight={22}
        $md={{ width: '67%' }}
        flex={1}
      >
        {definition}
      </Text>
    </XStack>
  )
}

function RetentionCard({ title, body }: { title: string; body: string }) {
  return (
    <YStack
      flex={1}
      gap="$2"
    >
      <Text
        fontFamily="$journal"
        fontSize={18}
        color="$color"
        borderBottomWidth={1}
        borderColor="$color2"
        paddingBottom="$2"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$color8"
        lineHeight={22}
      >
        {body}
      </Text>
    </YStack>
  )
}

function PostureLine({
  testID,
  title,
  body,
  onPress,
}: {
  testID: string
  title: string
  body: string
  onPress?: () => void
}) {
  // A pressable posture line (encrypted journal / Collective) carries a button
  // role and opens the shared review disclosure. The reserved AI-cloud line
  // passes no `onPress`: it renders as static, non-focusable text (NOT a
  // disabled control — a disabled control is still announced as a dead
  // affordance and visually implies a broken link).
  const interactive = onPress !== undefined
  return (
    <YStack
      testID={testID}
      gap="$2"
      {...(interactive
        ? {
            onPress,
            accessibilityRole: 'button' as const,
            cursor: 'pointer',
            hoverStyle: { opacity: 0.8 },
          }
        : {})}
    >
      <Text
        fontFamily="$journal"
        fontSize={18}
        color="$color"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$color8"
        lineHeight={22}
      >
        {body}
      </Text>
    </YStack>
  )
}

const STAGGER_MS = 100
// Every section below is gated on `visibleCount >= n`; keep this equal to the
// number of staggered sections so the last one actually reveals (a too-low
// count would silently hide a section forever).
const SECTION_COUNT = 6

export function PrivacyCenterScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const currentMode = use$(encryptionSetup$.currentMode)
  const syncEnabled = use$(store$.session.syncEnabled)
  const [visibleCount, setVisibleCount] = useState(0)
  // The Boundary A review disclosure, shared by the encrypted-journal and
  // Collective posture lines (its copy covers both). Review mode never mutates
  // the acknowledgment preference.
  const [reviewOpen, setReviewOpen] = useState(false)
  // The deletion-confirmation Dialog's open state. The Dialog stays mounted
  // regardless of auth (driven by this state), so its terminal goodbye survives
  // the sign-out-driven session flip — only the entry trigger is auth-gated.
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    const timers = Array.from({ length: SECTION_COUNT }, (_, i) =>
      setTimeout(() => setVisibleCount(i + 1), i * STAGGER_MS)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  const effectiveMode = isAuthenticated && syncEnabled && currentMode ? currentMode : null

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        testID="privacy-center-screen"
        width="100%"
        maxWidth={768}
        alignSelf="center"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={128}
        $sm={{ paddingHorizontal: '$6' }}
        $md={{ paddingHorizontal: '$8', paddingTop: '$8' }}
        $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
      >
        {/* Header */}
        <XStack
          justifyContent="space-between"
          alignItems="flex-start"
          marginBottom={64}
          flexDirection="column"
          gap="$4"
          $md={{ marginBottom: 96, alignItems: 'center', flexDirection: 'row' }}
        >
          <YStack gap="$2">
            <Text
              fontFamily="$journal"
              fontSize={30}
              $md={{ fontSize: 36 }}
              color="$color"
              letterSpacing={-0.5}
            >
              Privacy Center
            </Text>
            <Text
              fontFamily="$body"
              fontSize={14}
              color="$color8"
            >
              How River Journal handles your data and encryption.
            </Text>
          </YStack>
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$color8"
            letterSpacing={0.5}
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={() => router.back()}
          >
            Back
          </Text>
        </XStack>

        {/* Sections — staggered reveals */}
        <YStack gap={80}>
          <AnimatePresence>
            {/* 1. Privacy Modes */}
            {visibleCount >= 1 && (
              <YStack
                key="privacy-modes"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>Privacy Modes</SectionHeader>
                <XStack
                  flexDirection="column"
                  gap="$6"
                  $md={{ flexDirection: 'row' }}
                >
                  <PrivacyModeCard
                    title="Strict Privacy Mode"
                    quote={'"For advanced users who require absolute, uncompromised privacy."'}
                    bullets={[
                      'You hold the only key to unlock your journal.',
                      'Total privacy from everyone, including us.',
                      'Unrecoverable if you ever forget your password.',
                    ]}
                    isActive={effectiveMode === 'e2e'}
                  />
                  <PrivacyModeCard
                    title="Cloud Backup Mode"
                    quote={
                      '"The standard, hassle-free security method used by most everyday apps."'
                    }
                    bullets={[
                      'We securely handle the encryption behind the scenes.',
                      'Simple password recovery if you ever get locked out.',
                      'We can assist you if needed.',
                    ]}
                    isActive={effectiveMode === 'managed'}
                  />
                </XStack>
              </YStack>
            )}

            {/* 2. Privacy Postures — the v2 three-posture model. Always
                visible regardless of auth: an anonymous/local-only user can
                still read the postures and re-open the Boundary A review copy. */}
            {visibleCount >= 2 && (
              <YStack
                key="postures"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>Privacy Postures</SectionHeader>
                <YStack gap="$5">
                  <PostureLine
                    testID="posture-encrypted-journal"
                    title="Encrypted journal"
                    body="Your journal entries are encrypted on your device before they ever sync. We can't read them."
                    onPress={() => setReviewOpen(true)}
                  />
                  <PostureLine
                    testID="posture-collective"
                    title="Collective posts"
                    body="Posts you make in the Collective are stored as plain text on our servers. They are visible to other Collective members."
                    onPress={() => setReviewOpen(true)}
                  />
                  <PostureLine
                    testID="posture-ai-cloud"
                    title="AI cloud inference (Growth)"
                    body="When AI Reflection ships in a future release, you'll be able to choose between local inference (your writing never leaves your device) or cloud inference (sent to a named provider with a no-training commitment)."
                  />
                </YStack>
                {reviewOpen && (
                  <ThreePostureDisclosure
                    boundary="collective_post_v1"
                    mode="review"
                    open={reviewOpen}
                    onClose={() => setReviewOpen(false)}
                  />
                )}
              </YStack>
            )}

            {/* 3. What We Can & Cannot Access */}
            {visibleCount >= 3 && (
              <YStack
                key="access-info"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>What We Can & Cannot Access</SectionHeader>
                <YStack gap="$5">
                  <AccessRow
                    term="Local Only (No Sync)"
                    definition="Your journal stays entirely on this device. Nothing is ever sent to our servers."
                  />
                  <AccessRow
                    term="Strict Privacy Mode"
                    definition="We store encrypted data we cannot read. Your content is encrypted on your device before it leaves. If you lose your password, we cannot recover your cloud data."
                  />
                  <AccessRow
                    term="Cloud Backup Mode"
                    definition="We can access your data to provide support and account recovery. Your content is encrypted using a key stored on our server — similar to how most cloud services work."
                  />
                  <AccessRow
                    term="Synced Metadata"
                    definition="In both sync modes, metadata like word counts and timestamps is visible to us. Only journal content is encrypted."
                    showBorder={false}
                  />
                </YStack>
              </YStack>
            )}

            {/* 4. Data Retention & Deletion */}
            {visibleCount >= 4 && (
              <YStack
                key="retention"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>Data Retention & Deletion</SectionHeader>
                <XStack
                  flexDirection="column"
                  gap="$6"
                  $md={{ flexDirection: 'row' }}
                >
                  <RetentionCard
                    title="Cloud Data"
                    body="Stays in the cloud until you choose to delete it. We never remove it on our own."
                  />
                  <RetentionCard
                    title="Account Deletion"
                    body="Permanently wipes all server-side data, including all encrypted backups."
                  />
                  <RetentionCard
                    title="Local Data"
                    body="Entries on your device remain as anonymous local data, even after account deletion or disabling sync."
                  />
                </XStack>
                {/* Deletion entry — authenticated only (anonymous users have no
                    account to delete). Opens the always-mounted confirmation
                    Dialog below. */}
                {isAuthenticated && (
                  <Text
                    testID="delete-account-entry"
                    fontFamily="$body"
                    fontSize={11}
                    letterSpacing={2}
                    textTransform="uppercase"
                    color="$color8"
                    cursor="pointer"
                    hoverStyle={{ color: '$color' }}
                    onPress={() => setDeleteOpen(true)}
                    alignSelf="flex-start"
                  >
                    Delete account
                  </Text>
                )}
              </YStack>
            )}

            {/* 5. Your Data — the export data-rights affordances. Journal export
                is always available (anonymous/local-only included); Collective
                export is authenticated-only. */}
            {visibleCount >= 5 && (
              <YStack
                key="data-rights"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>Your Data</SectionHeader>
                <YStack gap="$8">
                  <ExportJournal />
                  {isAuthenticated && <ExportCollectivePosts />}
                </YStack>
              </YStack>
            )}

            {/* 6. Encrypted Backup — export/restore a passphrase-encrypted copy
                of the whole journal. Fully local; available to every user
                (including anonymous/local-only), so its entry points are never
                auth-gated. */}
            {visibleCount >= 6 && (
              <YStack
                key="encrypted-backup"
                transition="designEnter"
                enterStyle={{ opacity: 0, y: 10 }}
                opacity={1}
                y={0}
                gap="$6"
              >
                <SectionHeader>Encrypted Backup</SectionHeader>
                <BackupRestore />
              </YStack>
            )}
          </AnimatePresence>
        </YStack>

        {/* The deletion-confirmation Dialog stays mounted regardless of auth or
            stagger — its open/step state drives it, so the terminal goodbye
            survives the sign-out that flips isAuthenticated. Only the entry
            trigger above is auth-gated. */}
        <DeleteAccountFlow
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      </YStack>
    </ScrollView>
  )
}

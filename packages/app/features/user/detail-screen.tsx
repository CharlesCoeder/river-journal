import { Button, Paragraph, YStack } from '@my/ui'
import { ChevronLeft } from '@my/icons'
import { useRouter } from 'solito/navigation'

export function UserDetailScreen({ id }: { id: string }) {
  const router = useRouter()
  if (!id) {
    return null
  }
  return (
    <YStack
      flex={1}
      justifyContent="center"
      alignItems="center"
      gap="4"
      backgroundColor="background"
    >
      <Paragraph
        fontSize={16}
        lineHeight="web:normal"
        textAlign="center"
        fontWeight="700"
        color="blue10"
      >{`User ID: ${id}`}</Paragraph>
      <Button
        icon={ChevronLeft}
        onPress={() => router.back()}
      >
        Go Home
      </Button>
    </YStack>
  )
}

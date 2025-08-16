import LexicalEditor from './Lexical/LexicalEditor'
import { View, useTheme } from '@my/ui'

export const Editor = () => {
  const theme = useTheme()

  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  return (
    <View flex={1} width="100%" backgroundColor="$background">
      <LexicalEditor fontFamilies={{ content: 'PatrickHand', placeholder: 'SourceSans3' }} themeValues={themeValues} />
    </View>
  )
}

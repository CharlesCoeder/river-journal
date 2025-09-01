import { View, useTheme } from '@my/ui';
import { useObserve } from '@legendapp/state/react';
import { journal$ } from '../../../state/journal/store';
import LexicalEditor from './Lexical/LexicalEditor'; // This will resolve to .native on mobile
import { LexicalSync } from './Lexical/LexicalSync';

export const Editor = () => {
  const theme = useTheme();

  useObserve(journal$.activeFlow.content, ({ value }) => {
    console.log('3. ✅ Legend State Updated! New content:', value);
  });

  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  return (
    <View flex={1} width="100%" backgroundColor="$background">
      {/*
        LexicalEditor now acts as the provider. We pass LexicalSync
        as a child, so it is rendered within the same 'use dom' context.
      */}
      <LexicalEditor themeValues={themeValues}>
        <LexicalSync />
      </LexicalEditor>
    </View>
  );
};
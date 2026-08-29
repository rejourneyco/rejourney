import React from 'react';
import { Text } from 'react-native';
import { Mask } from '@rejourneyco/react-native';

// Compile-only compatibility contract. Brew intentionally stays on React 18
// while the local SDK is built in a React 19 workspace.
export function React18MaskConsumer(): React.ReactElement {
  return (
    <Mask>
      <Text>Synthetic private value</Text>
    </Mask>
  );
}

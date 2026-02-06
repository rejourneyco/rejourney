/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Mask Component
 * 
 * Wrapper component to mask sensitive content in session replays.
 * All children wrapped in this component will be obscured in recordings.
 * 
 * IMPORTANT: This file uses lazy loading to avoid "PlatformConstants could not be found"
 * errors on React Native 0.81+ with New Architecture (Bridgeless).
 * 
 * @example
 * ```tsx
 * import { Mask } from 'rejourney';
 * 
 * // Mask sensitive user ID
 * <Mask>
 *   <Text>User ID: {user.id}</Text>
 * </Mask>
 * 
 * // Mask credit card info
 * <Mask>
 *   <CreditCardDisplay card={card} />
 * </Mask>
 * ```
 */
import React from 'react';
import type { ViewProps } from 'react-native';

let _RN: typeof import('react-native') | null = null;

function getRN(): typeof import('react-native') | null {
    if (_RN) return _RN;
    try {
        _RN = require('react-native');
        return _RN;
    } catch {
        return null;
    }
}

export interface MaskProps extends ViewProps {
    children: React.ReactNode;
}

/**
 * Wrapper component to mask sensitive content in session replays.
 * All children will be obscured in recordings.
 * 
 * Uses accessibilityHint to signal to the native capture engine
 * that this view and its contents should be masked.
 */
export const Mask: React.FC<MaskProps> = ({ children, style, ...props }) => {
    const RN = getRN();

    if (!RN) {
        return <>{children}</>;
    }

    const { View, StyleSheet } = RN;

    const styles = StyleSheet.create({
        container: {
        },
    });

    return (
        <View
            {...props}
            style={[styles.container, style]}
            accessibilityHint="rejourney_occlude"
            collapsable={false}
        >
            {children}
        </View>
    );
};

export default Mask;

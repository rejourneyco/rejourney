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

import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  SharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from './Icon';
import { useTheme } from '../hooks/useTheme';
import { spacing } from '../theme';

// Native tab bar height varies. On iOS with NativeTabs (liquid glass), the
// bar is rendered natively and its height isn't exposed to JS. Use a generous
// value so the FAB always clears the tab bar + home indicator.
const NATIVE_TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 90 : 64;
const FAB_MARGIN = spacing.lg;

interface AnimatedFABProps {
  onPress: () => void;
  icon: IconName;
  visible: SharedValue<number>;
  /** Set to true when rendered inside a tab screen so the FAB clears the tab bar. */
  insideTabBar?: boolean;
}

export function AnimatedFAB({
  onPress,
  icon,
  visible,
  insideTabBar = false,
}: AnimatedFABProps) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();

  const bottomOffset = insideTabBar
    ? NATIVE_TAB_BAR_HEIGHT + FAB_MARGIN
    : insets.bottom + FAB_MARGIN;

  const rStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      visible.value,
      [0, 1],
      [150, 0],
      Extrapolation.CLAMP
    );

    const opacity = interpolate(
      visible.value,
      [0, 0.5, 1],
      [0, 0, 1],
      Extrapolation.CLAMP
    );

    const scale = interpolate(
      visible.value,
      [0, 1],
      [0.8, 1],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ translateY }, { scale }],
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.container, { bottom: bottomOffset }, rStyle]}>
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: c.accent }]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Icon name={icon} size={28} color="white" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 1000,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});

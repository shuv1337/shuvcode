import { Platform } from 'react-native';
import { NativeTabs, Icon, Label, VectorIcon } from 'expo-router/unstable-native-tabs';
import { useTheme } from '../../src/hooks/useTheme';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  const { isDark } = useTheme();

  const labelColor = Platform.OS === 'ios'
    ? { color: { dark: 'white', light: 'black' } as any }
    : isDark ? 'white' : 'black';

  const tintColor = Platform.OS === 'ios'
    ? { color: { dark: '#22d3ee', light: '#0891b2' } as any }
    : isDark ? '#22d3ee' : '#0891b2';

  return (
    <NativeTabs
      // iOS 26 Liquid Glass features
      minimizeBehavior="onScrollDown"
      disableTransparentOnScrollEdge={true}
      // Styling for liquid glass color adaptation
      labelStyle={{
        color: labelColor as any,
      }}
      tintColor={tintColor as any}
    >
      <NativeTabs.Trigger name="projects">
        <Icon
          sf={{ default: 'folder', selected: 'folder.fill' }}
          src={<VectorIcon family={Ionicons} name="folder-outline" /> as any}
        />
        <Label>Projects</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sessions">
        <Icon
          sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }}
          src={<VectorIcon family={Ionicons} name="chatbubble-outline" /> as any}
        />
        <Label>Sessions</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

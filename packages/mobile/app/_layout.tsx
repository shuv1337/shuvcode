import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OpenCodeProvider, useOpenCode } from '../src/providers/OpenCodeProvider';
import '../src/global.css';

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { connected, connecting, connect } = useOpenCode();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Wait for auto-connect to finish
    if (connecting) {
      return;
    }

    const inAuthGroup = segments[0] === '(tabs)';
    const inProtectedRoute = ['chat', 'new-project', 'project'].includes(segments[0] as string);

    if (!connected && (inAuthGroup || inProtectedRoute)) {
      router.replace('/connect');
    } else if (connected && segments[0] === 'connect') {
      router.replace('/(tabs)/projects');
    }
  }, [connected, connecting, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <SafeAreaProvider>
      <OpenCodeProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AuthRedirect>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen 
              name="chat/[id]" 
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen 
              name="project/[id]" 
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen 
              name="new-project" 
              options={{
                presentation: 'transparentModal',
                animation: 'slide_from_bottom',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="connect" />
            <Stack.Screen name="index" />
          </Stack>
        </AuthRedirect>
      </OpenCodeProvider>
    </SafeAreaProvider>
  );
}

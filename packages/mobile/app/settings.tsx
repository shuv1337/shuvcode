import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { useOpenCode } from '../src/providers/OpenCodeProvider';

export default function Settings() {
  const router = useRouter();
  const { serverUrl, disconnect } = useOpenCode();

  const handleDisconnect = useCallback(() => {
    disconnect();
    router.replace('/connect');
  }, [disconnect, router]);

  return (
    <SettingsScreen
      serverUrl={serverUrl}
      onDisconnect={handleDisconnect}
    />
  );
}

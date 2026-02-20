import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ConnectScreen } from '../src/screens/ConnectScreen';
import { useOpenCode } from '../src/providers/OpenCodeProvider';

export default function Connect() {
  const router = useRouter();
  const { serverUrl, setServerUrl, connect, connecting, error } = useOpenCode();

  const handleConnect = useCallback(async () => {
    const success = await connect(serverUrl);
    if (success) {
      router.replace('/(tabs)/sessions');
    }
  }, [connect, serverUrl, router]);

  return (
    <ConnectScreen
      serverUrl={serverUrl}
      onServerUrlChange={setServerUrl}
      onConnect={handleConnect}
      connecting={connecting}
      error={error}
    />
  );
}

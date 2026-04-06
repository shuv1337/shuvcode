import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SessionsScreen } from '../../../src/screens/SessionsScreen';
import { useOpenCode, Session } from '../../../src/providers/OpenCodeProvider';

export default function Sessions() {
  const router = useRouter();
  const {
    sessions,
    sessionsLoading,
    sessionsRefreshing,
    refreshSessions,
  } = useOpenCode();

  const handleSelectSession = useCallback((session: Session) => {
    router.push({ pathname: '/chat/[id]', params: { id: session.id } });
  }, [router]);

  return (
    <SessionsScreen
      sessions={sessions}
      loading={sessionsLoading}
      refreshing={sessionsRefreshing}
      onRefresh={refreshSessions}
      onSelectSession={handleSelectSession}
    />
  );
}

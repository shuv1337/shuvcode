import { useCallback } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ProjectSessionsScreen } from '../../src/screens/ProjectSessionsScreen';
import { useOpenCode, Session } from '../../src/providers/OpenCodeProvider';
import { getFolderName } from '../../src/utils/path';

export default function ProjectSessions() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    sessions,
    sessionsLoading,
    sessionsRefreshing,
    projects,
    refreshSessions,
    createSession,
  } = useOpenCode();

  const project = projects.find((p) => p.id === id);
  const projectName = project?.worktree ? getFolderName(project.worktree) : 'Project';

  const handleSelectSession = useCallback((session: Session) => {
    router.push({ pathname: '/chat/[id]', params: { id: session.id } });
  }, [router]);

  const handleCreateSession = useCallback(async () => {
    if (!project?.worktree) return;
    const session = await createSession(project.worktree);
    if (session) {
      router.push({ pathname: '/chat/[id]', params: { id: session.id } });
    }
  }, [project, createSession, router]);

  return (
    <ProjectSessionsScreen
      projectId={id || ''}
      projectWorktree={project?.worktree}
      projectName={projectName}
      sessions={sessions}
      loading={sessionsLoading}
      refreshing={sessionsRefreshing}
      onRefresh={refreshSessions}
      onSelectSession={handleSelectSession}
      onCreateSession={handleCreateSession}
    />
  );
}

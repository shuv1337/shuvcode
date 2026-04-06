import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ProjectsScreen } from '../../../src/screens/ProjectsScreen';
import { useOpenCode, Project } from '../../../src/providers/OpenCodeProvider';

export default function Projects() {
  const router = useRouter();
  const { projects, projectsLoading, refreshProjects } = useOpenCode();
  
  const handleSelectProject = useCallback((project: Project) => {
    router.push(`/project/${project.id}`);
  }, [router]);

  const handleCreateProject = useCallback(() => {
    router.push('/new-project');
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      refreshProjects();
    }, [refreshProjects])
  );

  return (
    <ProjectsScreen
      projects={projects}
      loading={projectsLoading}
      refreshing={false}
      onRefresh={refreshProjects}
      onSelectProject={handleSelectProject}
      onCreateProject={handleCreateProject}
    />
  );
}

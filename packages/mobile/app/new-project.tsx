import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { NewProjectScreen } from '../src/screens/NewProjectScreen';
import { useOpenCode } from '../src/providers/OpenCodeProvider';

export default function NewProject() {
  const router = useRouter();
  const { refreshProjects } = useOpenCode();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSelectDirectory = useCallback(async (path: string) => {
    console.log('Opening directory:', path);
    await refreshProjects();
    router.back();
  }, [refreshProjects, router]);

  const handleCloneRepository = useCallback(async (url: string, path?: string) => {
    console.log('Cloning repository:', url, 'to:', path);
    await refreshProjects();
    router.back();
  }, [refreshProjects, router]);

  return (
    <NewProjectScreen
      onBack={handleBack}
      onSelectDirectory={handleSelectDirectory}
      onCloneRepository={handleCloneRepository}
    />
  );
}

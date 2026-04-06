import React from 'react';
import { FlatList, Image, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgUri } from 'react-native-svg';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import { AnimatedFAB } from '../components/AnimatedFAB';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import type { Project } from '../providers/OpenCodeProvider';
import { getFolderName, shortenPath } from '../utils/path';

const WSafeAreaView = withUniwind(SafeAreaView);
const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);

interface ProjectsScreenProps {
  projects: Project[];
  loading: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSelectProject?: (project: Project) => void;
  onCreateProject: () => void;
}

function isSvg(src: string) {
  return src.startsWith('data:image/svg+xml') || src.toLowerCase().endsWith('.svg');
}

function ProjectAvatar({ project, accent }: { project: Project; accent: string }) {
  const [failed, setFailed] = React.useState(false);
  const src = project.icon?.override || project.icon?.url;
  if (!src || failed) return <Icon name="folder-open" size={20} color={accent} />;

  if (isSvg(src)) {
    return (
      <SvgUri
        uri={src}
        width={22}
        height={22}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Image
      source={{ uri: src }}
      style={{ width: 22, height: 22, borderRadius: 6 }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export function ProjectsScreen({
  projects,
  loading,
  refreshing = false,
  onRefresh,
  onSelectProject,
  onCreateProject,
}: ProjectsScreenProps) {
  const { colors } = useTheme();
  const visible = useSharedValue(1);
  const offset = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const current = event.contentOffset.y;
      const diff = current - offset.value;
      if (Math.abs(diff) < 10 || current < 0) return;
      if (diff > 0 && current > 50 && visible.value !== 0) visible.value = withTiming(0, { duration: 200 });
      if (diff < 0 && visible.value !== 1) visible.value = withTiming(1, { duration: 200 });
      offset.value = current;
    },
  });

  return (
    <WSafeAreaView className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Projects"
        subtitle={`${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
      />

      <Animated.FlatList
        data={projects}
        keyExtractor={(item: Project) => item.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }: { item: Project }) => (
          <WTouchableOpacity
            className="mx-4 mb-2 flex-row items-center rounded-2xl border px-4 py-4"
            style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}
            activeOpacity={0.8}
            onPress={() => onSelectProject?.(item)}
          >
            <WView className="h-11 w-11 items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: `${colors.accent}1f` }}>
              <ProjectAvatar project={item} accent={colors.accent} />
            </WView>
            <WView className="ml-3 flex-1">
              <WText className="text-base font-semibold" style={{ color: colors.text }}>{item.worktree ? getFolderName(item.worktree) : 'Unknown Project'}</WText>
              {item.worktree ? <WText className="mt-1 text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>{shortenPath(item.worktree)}</WText> : null}
            </WView>
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </WTouchableOpacity>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: 100, flexGrow: projects.length ? 0 : 1 }}
        ListEmptyComponent={
          <EmptyState
            icon="folder-open"
            title={loading ? 'Loading...' : 'No Projects'}
            description={loading ? 'Fetching your projects' : 'Open a project in OpenCode to see it here'}
            accent={colors.accent}
          />
        }
      />

      <AnimatedFAB icon="plus" onPress={onCreateProject} visible={visible} insideTabBar />
    </WSafeAreaView>
  );
}

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import { AnimatedFAB } from '../components/AnimatedFAB';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { formatRelativeDate } from '../utils/date';
import type { Session, SessionWithPreview } from '../providers/OpenCodeProvider';
import { getFolderName } from '../utils/path';

const WSafeAreaView = withUniwind(SafeAreaView);
const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);

interface ProjectSessionsScreenProps {
  projectId: string;
  projectWorktree?: string;
  projectName: string;
  sessions: SessionWithPreview[];
  loading: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSelectSession: (session: Session) => void;
  onCreateSession: () => void;
}

interface GroupedSession extends SessionWithPreview {
  children?: SessionWithPreview[];
}

export function ProjectSessionsScreen({
  projectId,
  projectWorktree,
  projectName,
  sessions,
  loading,
  refreshing = false,
  onRefresh,
  onSelectSession,
  onCreateSession,
}: ProjectSessionsScreenProps) {
  const { colors } = useTheme();
  const visible = useSharedValue(1);
  const offset = useSharedValue(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const list = useMemo(() => {
    const filtered = sessions.filter((session) => {
      if (projectWorktree && session.directory) return session.directory === projectWorktree;
      return session.projectID === projectId;
    });
    const parents: GroupedSession[] = [];
    const children = new Map<string, SessionWithPreview[]>();
    for (const session of filtered) {
      if (!session.parentID) {
        parents.push({ ...session });
        continue;
      }
      const existing = children.get(session.parentID) ?? [];
      existing.push(session);
      children.set(session.parentID, existing);
    }
    for (const session of parents) {
      const nested = children.get(session.id);
      if (!nested) continue;
      session.children = nested.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
    }
    return parents.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
  }, [sessions, projectId, projectWorktree]);

  const renderItem = useCallback(({ item }: { item: GroupedSession }) => {
    const open = expanded.has(item.id);
    const child = item.children ?? [];
    const hasChild = child.length > 0;
    return (
      <WView className="mx-4 mb-2">
        <WTouchableOpacity
          className="flex-row items-center rounded-2xl border px-4 py-3"
          style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}
          activeOpacity={0.8}
          onPress={() => onSelectSession(item)}
        >
          <WView className="flex-1">
            <WView className="flex-row items-center justify-between gap-3">
              <WText className="flex-1 text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>{item.title || 'Untitled Session'}</WText>
              <WText className="text-[11px]" style={{ color: colors.textMuted }}>{formatRelativeDate(item.time?.updated ?? item.time?.created)}</WText>
            </WView>
            {item.preview ? <WText className="mt-1 text-xs" numberOfLines={1} style={{ color: colors.textSecondary }}>{item.preview}</WText> : null}
          </WView>
          {hasChild ? (
            <WTouchableOpacity
              className="ml-2 flex-row items-center gap-1 rounded-lg px-2 py-1"
              style={{ backgroundColor: `${colors.accent}1f` }}
              onPress={() => setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })}
            >
              <WText className="text-xs font-semibold" style={{ color: colors.accent }}>{child.length}</WText>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
            </WTouchableOpacity>
          ) : <Icon name="chevron-right" size={18} color={colors.textMuted} />}
        </WTouchableOpacity>

        {hasChild && open ? (
          <WView className="mt-2 gap-2 pl-4">
            {child.map((nested) => (
              <WTouchableOpacity
                key={nested.id}
                className="flex-row items-center rounded-xl border px-3 py-3"
                style={{ backgroundColor: colors.bgElevated, borderColor: colors.border }}
                activeOpacity={0.8}
                onPress={() => onSelectSession(nested)}
              >
                <WView className="mr-2 h-6 w-1 rounded-full" style={{ backgroundColor: colors.accent }} />
                <WView className="flex-1">
                  <WText className="text-xs font-medium" numberOfLines={1} style={{ color: colors.text }}>{nested.title || 'Untitled Session'}</WText>
                  {nested.preview ? <WText className="mt-1 text-[11px]" numberOfLines={1} style={{ color: colors.textSecondary }}>{nested.preview}</WText> : null}
                </WView>
                <WText className="ml-2 text-[10px]" style={{ color: colors.textMuted }}>{formatRelativeDate(nested.time?.updated ?? nested.time?.created)}</WText>
              </WTouchableOpacity>
            ))}
          </WView>
        ) : null}
      </WView>
    );
  }, [colors, expanded, onSelectSession]);

  return (
    <WSafeAreaView className="flex-1" style={{ backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title={projectName || getFolderName(projectWorktree || '')}
        subtitle={`${list.length} ${list.length === 1 ? 'session' : 'sessions'}`}
      />

      <Animated.FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderItem as any}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: list.length || loading ? 110 : 16, flexGrow: list.length ? 0 : 1 }}
        ListEmptyComponent={
          loading ? (
            <WView className="flex-1 items-center justify-center">
              <WText className="text-xl font-semibold" style={{ color: colors.text }}>Loading...</WText>
              <WText className="mt-2 text-sm" style={{ color: colors.textSecondary }}>Fetching sessions for this project</WText>
            </WView>
          ) : (
            <EmptyState
              icon="message-square"
              title="No Sessions"
              description="Start a new session to begin"
              accent={colors.accent}
              action={
                <WTouchableOpacity className="flex-row items-center rounded-full px-5 py-3" style={{ backgroundColor: colors.accent }} onPress={onCreateSession}>
                  <Icon name="plus" size={18} color={colors.textInverse} />
                  <WText className="ml-2 text-sm font-semibold" style={{ color: colors.textInverse }}>New Session</WText>
                </WTouchableOpacity>
              }
            />
          )
        }
      />

      <AnimatedFAB icon="plus" onPress={onCreateSession} visible={visible} insideTabBar />
    </WSafeAreaView>
  );
}

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import { spacing, radius, typography } from '../theme';

interface SettingsScreenProps {
  serverUrl: string;
  onDisconnect: () => void;
}

export function SettingsScreen({
  serverUrl,
  onDisconnect,
}: SettingsScreenProps) {
  const { theme, colors: c } = useTheme();
  const insets = useSafeAreaInsets();

  // Extra padding for the floating liquid glass tab bar on iOS/iPad
  const topPadding = Platform.OS === 'ios' ? insets.top + 60 : insets.top + spacing.lg;

  return (
    <View style={theme.container}>
      {/* Header */}
      <View style={[theme.header, { paddingTop: topPadding }]}>
        <View>
          <Text style={theme.title}>Settings</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Connection Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
            CONNECTION
          </Text>
          
          <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={styles.row}>
              <View style={[styles.iconContainer, { backgroundColor: c.accentSubtle }]}>
                <Icon name="wifi" size={18} color={c.accent} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: c.text }]}>Server</Text>
                <Text style={[styles.rowValue, { color: c.textSecondary }]} numberOfLines={1}>
                  {serverUrl}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: c.success }]} />
            </View>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
            ABOUT
          </Text>
          
          <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={styles.row}>
              <View style={[styles.iconContainer, { backgroundColor: c.accentSubtle }]}>
                <Icon name="zap" size={18} color={c.accent} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: c.text }]}>OpenPad</Text>
                <Text style={[styles.rowValue, { color: c.textSecondary }]}>
                  Version 1.0.0
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Actions Section */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.disconnectButton, { backgroundColor: `${c.error}15` }]}
            onPress={onDisconnect}
            activeOpacity={0.7}
          >
            <Icon name="logout" size={20} color={c.error} />
            <Text style={[styles.disconnectText, { color: c.error }]}>
              Disconnect
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.caption,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  rowLabel: {
    ...typography.bodyMedium,
  },
  rowValue: {
    ...typography.small,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  disconnectText: {
    ...typography.bodyMedium,
  },
});

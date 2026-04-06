import React from 'react';
import { Text, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { Icon, type IconName } from '../Icon';
import { useTheme } from '../../hooks/useTheme';

const WView = withUniwind(View);
const WText = withUniwind(Text);

export function EmptyState({
  icon,
  title,
  description,
  accent,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  accent: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <WView className="flex-1 items-center justify-center px-10">
      <WView className="h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: `${accent}22` }}>
        <Icon name={icon} size={28} color={accent} />
      </WView>
      <WText className="mt-5 text-xl font-semibold" style={{ color: colors.text }}>{title}</WText>
      <WText className="mt-2 text-center text-sm leading-6" style={{ color: colors.textSecondary }}>{description}</WText>
      {action ? <WView className="mt-5">{action}</WView> : null}
    </WView>
  );
}

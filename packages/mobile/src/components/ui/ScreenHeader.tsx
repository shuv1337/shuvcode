import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { useTheme } from '../../hooks/useTheme';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);

export function ScreenHeader({
  title,
  subtitle,
  right,
  onRightPress,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onRightPress?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <WView className="flex-row items-end justify-between px-5 pb-3 pt-4">
      <WView>
        <WText className="text-3xl font-semibold" style={{ color: colors.text }}>{title}</WText>
        {subtitle ? <WText className="mt-1 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>{subtitle}</WText> : null}
      </WView>
      {right ? (
        <WTouchableOpacity className="h-10 w-10 items-center justify-center rounded-xl border" style={{ backgroundColor: colors.bgCard, borderColor: colors.border }} onPress={onRightPress}>
          {right}
        </WTouchableOpacity>
      ) : null}
    </WView>
  );
}

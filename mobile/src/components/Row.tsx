import * as React from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/** The chevron that points onward: right, or left in a right-to-left language. */
export const Onward = I18nManager.isRTL ? ChevronLeft : ChevronRight;

export type RowProps = Omit<React.ComponentProps<typeof Pressable>, 'children'> & {
  label: string;
  /** The current value or a line about the row, under the label: it wraps rather than squeezing the label. */
  value?: string;
  /** Why the row cannot be used now; shown in the row and read with it. */
  disabledReason?: string;
  /** What sits at the end: a switch, a check. A row with one shows no chevron. */
  accessory?: React.ReactNode;
  /** Shown by default on a row that opens something (it has onPress and no accessory). */
  chevron?: boolean;
  icon?: LucideIcon;
  destructive?: boolean;
};

/**
 * A whole-width row: the label, the value, the padding and the chevron are one
 * touch target (design scope §1). Any other props, the ref included, reach the
 * Pressable, so a row can be a DropdownMenuTrigger's asChild.
 */
export function Row({ label, value, disabledReason, accessory, chevron, icon, destructive, disabled, className, accessibilityState, accessibilityHint, ...props }: RowProps) {
  const onward = chevron ?? (!accessory && !!props.onPress);
  const reason = disabled && disabledReason ? disabledReason : undefined;
  return (
    <Pressable
      // A row that does something is a button; one that only shows a value is read as text.
      role={props.onPress ? 'button' : undefined}
      {...props}
      disabled={disabled}
      accessibilityState={{ ...accessibilityState, disabled: !!disabled }}
      // The reason is in the row's own text, which a screen reader reads with it; not repeated as a hint.
      accessibilityHint={accessibilityHint}
      className={cn('min-h-14 flex-row items-center gap-3 px-4 py-3', !disabled && props.onPress && 'active:bg-accent', className)}
    >
      {icon ? <Icon as={icon} size={20} className={cn('text-muted-foreground', disabled && 'opacity-60')} /> : null}
      <View className="flex-1 gap-0.5">
        <View className={cn('gap-0.5', disabled && 'opacity-60')}>
          <Text className={cn(destructive && 'text-destructive')}>{label}</Text>
          {value ? <Text className="text-muted-foreground text-sm">{value}</Text> : null}
        </View>
        {/* Full strength: the reason is what a disabled row has to say. */}
        {reason ? <Text className="text-muted-foreground text-sm">{reason}</Text> : null}
      </View>
      {accessory}
      {onward ? <Icon as={Onward} size={20} className="text-muted-foreground" /> : null}
    </Pressable>
  );
}

/** Rows under a heading, in one bordered block with a line between each. */
export function RowGroup({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View className="gap-2">
      {title ? <Text role="heading" className="text-muted-foreground px-4 text-sm font-medium">{title}</Text> : null}
      <View className="border-border bg-card mx-4 overflow-hidden rounded-lg border">
        {rows.map((row, i) => (
          <React.Fragment key={React.isValidElement(row) && row.key != null ? row.key : i}>
            {i > 0 ? <Separator /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
      {footer ? <Text className="text-muted-foreground px-4 text-sm">{footer}</Text> : null}
    </View>
  );
}

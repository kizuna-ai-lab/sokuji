import { View } from 'react-native';
import { Switch } from '@/components/ui/switch';
import { Row } from './Row';

/**
 * A row that is a switch: the row is the one touch target and the one element
 * a screen reader reads (name, on/off, disabled), so a tap on the switch or
 * anywhere else on the row toggles once.
 */
export function SwitchRow({ label, value, checked, onCheckedChange, disabled, disabledReason }: {
  label: string;
  value?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Row
      label={label}
      value={value}
      role="switch"
      accessibilityState={{ checked }}
      disabled={disabled}
      disabledReason={disabledReason}
      onPress={() => onCheckedChange(!checked)}
      accessory={
        // The switch is a picture of the row's state, not a second stop: hidden on its own too,
        // and the wrapper kept (not flattened away), since TalkBack still stopped on it and read
        // only "on" (Sophie, Android).
        <View collapsable={false} style={{ pointerEvents: 'none' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>
      }
    />
  );
}

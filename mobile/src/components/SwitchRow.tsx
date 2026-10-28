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
        <View style={{ pointerEvents: 'none' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
        </View>
      }
    />
  );
}

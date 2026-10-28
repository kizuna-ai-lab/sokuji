import { ScrollView, useWindowDimensions, type HostInstance } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { refocus } from './focus';

/**
 * "Are you sure?" before an action that cannot be undone. Cancel does nothing;
 * when it closes, the screen reader goes back to `returnTo`, what opened it.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, destructive, onConfirm, returnTo, portalHost }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  returnTo?: React.RefObject<HostInstance | null>;
  /** The portal to render in, when opened from inside a sheet (OptionSheet's SHEET_PORTAL). */
  portalHost?: string;
}) {
  const { height } = useWindowDimensions();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next && returnTo) refocus(returnTo);
      }}
    >
      <AlertDialogContent portalHost={portalHost}>
        {/* At the largest text sizes the words scroll and the buttons stay on screen. */}
        <ScrollView style={{ maxHeight: height * 0.5 }} bounces={false}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? <AlertDialogDescription className="text-base">{description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
        </ScrollView>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Text>{cancelLabel}</Text>
          </AlertDialogCancel>
          <AlertDialogAction className={cn(destructive && buttonVariants({ variant: 'destructive' }))} onPress={onConfirm}>
            <Text className={cn(destructive && 'text-white')}>{confirmLabel}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

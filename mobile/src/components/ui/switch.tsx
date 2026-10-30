import { cn } from '@/lib/utils';
import * as SwitchPrimitives from '@rn-primitives/switch';
import { Platform } from 'react-native';

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitives.Root>) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        // Sokuji: the platforms' switch size (about 28×48) rather than the web's 18×32.
        'flex h-7 w-12 shrink-0 flex-row items-center rounded-full border border-transparent px-px shadow-sm shadow-black/5',
        Platform.select({
          web: 'focus-visible:border-ring focus-visible:ring-ring/50 peer inline-flex outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      <SwitchPrimitives.Thumb
        className={cn(
          'bg-background size-6 rounded-full transition-transform',
          Platform.select({
            web: 'pointer-events-none block ring-0',
          }),
          props.checked
            ? 'dark:bg-primary-foreground translate-x-5'
            : 'dark:bg-foreground translate-x-0'
        )}
      />
    </SwitchPrimitives.Root>
  );
}

export { Switch };

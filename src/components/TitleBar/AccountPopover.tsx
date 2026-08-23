// src/components/TitleBar/AccountPopover.tsx
//
// A popover rather than a third side panel. Settings and Logs are mutually
// exclusive panels, so making the account a third one would CLOSE the
// settings panel to show a balance — interrupting exactly the path this
// work exists to smooth. The product already splits the two languages:
// panels for sustained configuration, popovers for a glance.
import React from 'react';
import {
  useFloating, useDismiss, useRole, useInteractions, FloatingPortal,
  FloatingFocusManager, offset, flip, shift, size, autoUpdate,
} from '@floating-ui/react';
import { useAuth } from '../../lib/auth/hooks';
import { UserAccountInfo } from '../Auth/UserAccountInfo';
import './AccountPopover.scss';

interface AccountPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const AccountPopover: React.FC<AccountPopoverProps> = ({ open, anchorEl, onClose }) => {
  const { isSignedIn } = useAuth();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'bottom-end',
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${availableHeight}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  // useRole gives the floating element role="dialog" and an accessible name;
  // FloatingFocusManager moves keyboard focus into the popover and restores it
  // to the button on close. Without them a keyboard user opens the popover and
  // then tabs into the page BEHIND it. Both are what ExportButton and
  // SubtitleBar already do — this is copying the house pattern, not inventing.
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  React.useEffect(() => {
    refs.setReference(anchorEl);
  }, [anchorEl, refs]);

  if (!open) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="account-popover"
          {...getFloatingProps()}
        >
          {isSignedIn && <UserAccountInfo />}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

export default AccountPopover;

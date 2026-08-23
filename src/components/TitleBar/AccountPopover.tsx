// src/components/TitleBar/AccountPopover.tsx
//
// A popover rather than a third side panel. Settings and Logs are mutually
// exclusive panels, so making the account a third one would CLOSE the
// settings panel to show a balance — interrupting exactly the path this
// work exists to smooth. The product already splits the two languages:
// panels for sustained configuration, popovers for a glance.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'bottom-end',
    // Declarative reference, matching ModeDevicePopover. Setting it from an
    // effect instead works, but lands one frame after first paint — and since
    // the anchor is a ref that is null until the click-triggered re-render,
    // that stray frame would hit EVERY first open, drawing the popover at
    // translate(0,0) before it corrects.
    elements: { reference: anchorEl ?? undefined },
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          // Clamped because floating-ui can hand back a transient negative
          // during a reposition — the same guard ModeDevicePopover and
          // ExportButton both carry.
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
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
          {isSignedIn ? (
            <UserAccountInfo />
          ) : (
            <>
              <p className="account-popover__msg">
                {t('simpleConfig.signInRequired',
                   "Sign up to use Sokuji's built-in translation service — no API key needed. You can also keep using your own provider and key.")}
              </p>
              <div className="account-popover__btns">
                <button
                  type="button"
                  className="account-popover__btn account-popover__btn--primary"
                  onClick={() => { navigate('/sign-up'); onClose(); }}
                >
                  {t('common.signUp', 'Sign Up')}
                </button>
                <button
                  type="button"
                  className="account-popover__btn account-popover__btn--ghost"
                  onClick={() => { navigate('/sign-in'); onClose(); }}
                >
                  {t('common.signIn', 'Sign In')}
                </button>
              </div>
            </>
          )}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

export default AccountPopover;

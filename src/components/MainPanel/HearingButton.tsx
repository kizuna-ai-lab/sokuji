// src/components/MainPanel/HearingButton.tsx
//
// The toolbar's headphones entry (providers and stages design, ruling 19):
// one quiet icon that opens a popover, as the share-captions button does,
// with the rows of what I hear that apply in this mode. The rows follow the
// speech section's rules (useHearingRows); the popover links to Audio.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeadphoneOff, Headphones } from 'lucide-react';
import {
  useFloating, autoUpdate, offset, flip, shift,
  useClick, useDismiss, useRole, useInteractions, FloatingPortal, FloatingFocusManager,
} from '@floating-ui/react';
import { useSessionLocked } from '../../app/useRun';
import { useNavigateToSettings } from '../../stores/settingsStore';
import { OutletSelect } from '../Settings/shared/OutletSelect';
import { useHearingRows } from './useHearingRows';
import './HearingButton.scss';

export const HearingButton: React.FC = () => {
  const { t } = useTranslation();
  const locked = useSessionLocked();
  const h = useHearingRows(locked);
  const navigateToSettings = useNavigateToSettings();
  const [open, setOpen] = useState(false);
  const floating = useFloating({
    open, onOpenChange: setOpen, placement: 'bottom-end', whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });
  const interactions = useInteractions([useClick(floating.context), useDismiss(floating.context), useRole(floating.context, { role: 'dialog' })]);

  // Face to face, each person's ear is set where the session starts; the entry is not shown (ruling 6).
  const them = h.theirLegRuns && h.participantOffered && h.speech !== 'never';
  const me = h.myLegRuns && !h.faceToFace && h.otherOn;
  if (h.faceToFace || (!them && !me)) return null;

  const themLabel = t('audioPanel.iHear', 'Translation I hear');
  const meLabel = t('audioPanel.meToo', 'I hear it too');
  const allOff = (!them || !h.themOn) && (!me || !h.meChecked);
  const label = t('mainPanel.whatIHear', 'What I hear');
  const lockedByRun = t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.');

  const row = (key: string, text: string, checked: boolean, disabled: boolean, title: string | undefined, toggle: () => void, outlet: 'them' | 'me') => (
    <div className="hearing-popover__row" key={key}>
      <button type="button" role="switch" aria-checked={checked} aria-label={text} className={`hearing-popover__switch${checked ? ' is-on' : ''}`}
        disabled={disabled} title={title} onClick={toggle}>
        <span className="hearing-popover__thumb" aria-hidden="true" />
      </button>
      <span className="hearing-popover__label">{text}</span>
      <OutletSelect name={outlet} label={text} faceToFace={false} />
    </div>
  );

  return (
    <>
      <button className="font-size-btn hearing-btn" ref={floating.refs.setReference} {...interactions.getReferenceProps()}
        title={label} aria-label={label} type="button" data-hearing={allOff ? 'off' : 'on'}>
        {allOff ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
      </button>
      {open && (
        <FloatingPortal>
          {/* Non-modal: the focus enters the popover, Tab follows on from the button, Esc or a click outside returns it. */}
          <FloatingFocusManager context={floating.context} modal={false}>
          <div ref={floating.refs.setFloating} className="hearing-popover" style={floating.floatingStyles} aria-label={label} {...interactions.getFloatingProps()}>
            {them && row('them', themLabel, h.themOn, h.themLocked || h.recaptured || !h.participantOffered || h.speech !== 'optional', h.themLocked ? lockedByRun : undefined, h.toggleThem, 'them')}
            {me && row('me', meLabel, h.meChecked, h.meDisabled, undefined, h.toggleMe, 'me')}
            <button type="button" className="hearing-popover__link" onClick={() => { setOpen(false); navigateToSettings('speech'); }}>
              {t('mainPanel.audioSettings', 'Audio settings')}
            </button>
          </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

export default HearingButton;

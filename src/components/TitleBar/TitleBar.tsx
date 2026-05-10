// src/components/TitleBar/TitleBar.tsx
import React, { useCallback } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { isMacOS } from '../../utils/environment';
import './TitleBar.scss';

const TitleBar: React.FC = () => {
  const minimize = useCallback(() => {
    void window.electron?.invoke('window:minimize');
  }, []);
  const maximizeToggle = useCallback(() => {
    void window.electron?.invoke('window:maximize-toggle');
  }, []);
  const close = useCallback(() => {
    void window.electron?.invoke('window:close');
  }, []);

  if (isMacOS()) {
    // macOS: traffic-light buttons drawn by the OS via titleBarStyle: 'hiddenInset'.
    // We just render a thin draggable area with the title.
    return (
      <div className="title-bar platform-darwin" role="banner">
        <span className="title-bar__title">Sokuji</span>
      </div>
    );
  }

  return (
    <div className="title-bar platform-other" role="banner">
      <span className="title-bar__title">Sokuji</span>
      <div className="title-bar__buttons">
        <button
          type="button"
          className="title-bar__btn title-bar__minimize"
          aria-label="Minimize"
          onClick={minimize}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__maximize"
          aria-label="Maximize"
          onClick={maximizeToggle}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__close"
          aria-label="Close"
          onClick={close}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;

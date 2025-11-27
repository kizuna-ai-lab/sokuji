/**
 * Lightbox Component
 * Full-screen image preview with keyboard and click-to-close support
 */

import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import './Lightbox.scss';

interface LightboxProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export function Lightbox({ src, alt, isOpen, onClose }: LightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="lightbox" onClick={handleBackdropClick}>
      <button className="lightbox__close" onClick={onClose} aria-label="Close">
        <X size={32} />
      </button>
      <div className="lightbox__content">
        <img className="lightbox__img" src={src} alt={alt} />
        {alt && <div className="lightbox__caption">{alt}</div>}
      </div>
    </div>
  );
}

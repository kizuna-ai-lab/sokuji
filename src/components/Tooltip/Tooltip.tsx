import React, { useState, cloneElement, isValidElement } from 'react';
import { HelpCircle, Info } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  arrow,
  useClick,
  safePolygon,
  FloatingArrow
} from '@floating-ui/react';
import './Tooltip.scss';

interface TooltipProps {
  content: string | React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click';
  icon?: 'help' | 'info' | 'none';
  maxWidth?: number;
}

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  trigger = 'hover',
  icon = 'help',
  maxWidth = 250
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const arrowRef = React.useRef(null);

  const { refs, floatingStyles, context, placement } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: position,
    middleware: [
      offset(10),
      flip({
        fallbackAxisSideDirection: 'start',
        crossAxis: false,
      }),
      shift({ 
        padding: 8,
        crossAxis: true,
      }),
      arrow({
        element: arrowRef,
      }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });

  // Interaction hooks based on trigger type
  const hover = useHover(context, {
    enabled: trigger === 'hover',
    delay: { open: 100, close: 0 },
    handleClose: safePolygon(),
  });
  
  const click = useClick(context, {
    enabled: trigger === 'click',
  });

  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    trigger === 'hover' ? hover : click,
    focus,
    dismiss,
    role,
  ]);

  const renderIcon = () => {
    if (icon === 'none' || children) return null;
    
    const IconComponent = icon === 'info' ? Info : HelpCircle;
    return <IconComponent size={16} />;
  };

  const triggerElement = children || renderIcon();

  return (
    <>
      {isValidElement(triggerElement) ? (
        cloneElement(
          triggerElement,
          getReferenceProps({
            ref: refs.setReference,
            ...(triggerElement.props as any),
            className: `${(triggerElement.props as any)?.className || ''} tooltip-trigger`.trim(),
          })
        )
      ) : (
        <span
          ref={refs.setReference}
          {...getReferenceProps()}
          className="tooltip-trigger"
        >
          {triggerElement}
        </span>
      )}
      <FloatingPortal>
        {isOpen && (
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              maxWidth,
              zIndex: 9999,
            }}
            className={`tooltip-content ${placement}`}
            {...getFloatingProps()}
          >
            <FloatingArrow 
              ref={arrowRef} 
              context={context}
              className="tooltip-arrow"
              width={10}
              height={5}
              tipRadius={2}
              fill="#2a2a2a"
              stroke="#444"
              strokeWidth={1}
            />
            <div className="tooltip-body">{content}</div>
          </div>
        )}
      </FloatingPortal>
    </>
  );
};

export default Tooltip;
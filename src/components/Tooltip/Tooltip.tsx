import React, { useState, useEffect, useCallback, cloneElement, isValidElement } from 'react';
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
  useMergeRefs,
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
  /** Hover open delay in ms (default 100). Pass 0 for an instant tooltip. */
  openDelay?: number;
}

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  trigger = 'hover',
  icon = 'help',
  maxWidth = 250,
  openDelay = 100
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Effects unmount when an ancestor <Activity> hides (panel switch) as well
  // as on real unmount; reset so a tooltip open at hide time doesn't
  // reappear frozen on the next reveal.
  useEffect(() => () => setIsOpen(false), []);
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
    delay: { open: openDelay, close: 0 },
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

  // A trigger can live in ANOTHER window's document: the subtitle bar hosts
  // its popovers in child BrowserWindows and portals React into them, so one
  // React tree spans two documents. Left to itself FloatingPortal lands in
  // `document.body` — THIS document's — painting the tooltip in the wrong
  // window and positioning it with that window's coordinates. So the portal
  // container is the trigger's own body, whichever document that is.
  //
  // `null` means "not resolved yet", and that is load-bearing rather than a
  // tidy initial value: FloatingPortal builds its portal node in the first
  // layout effect and then keeps it forever (portalNodeRef short-circuits
  // every later run), so a root that arrives afterwards is ignored. Passing
  // null is the one input it waits on. The ref fires in the same commit, one
  // render before anything can open, so nothing is delayed in practice.
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const setReference = useCallback((node: Element | null) => {
    refs.setReference(node);
    // Only ever set, never cleared: a detach on unmount must not tear the
    // portal node down and rebuild it somewhere else.
    if (node) setPortalRoot(node.ownerDocument.body);
  }, [refs.setReference]);

  // React 19 passes ref as a regular prop, so a caller-supplied ref on the
  // trigger child arrives via props and must be merged with (not clobbered
  // by, nor clobbering) the floating-ui anchor ref.
  const childRef = isValidElement(triggerElement)
    ? (triggerElement.props as { ref?: React.Ref<Element> }).ref
    : undefined;
  const triggerRef = useMergeRefs([setReference, childRef]);

  // Function to render content with line break support
  const renderContent = () => {
    if (typeof content === 'string' && content.includes('\n')) {
      return content.split('\n').map((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return null; // Skip empty lines
        return (
          <div 
            key={index} 
            style={{ 
              marginBottom: index < content.split('\n').length - 1 ? '4px' : 0 
            }}
          >
            {trimmedLine}
          </div>
        );
      }).filter(Boolean); // Remove null entries
    }
    return content;
  };

  return (
    <>
      {isValidElement(triggerElement) ? (
        cloneElement(
          triggerElement,
          getReferenceProps({
            ...(triggerElement.props as any),
            ref: triggerRef,
            className: `${(triggerElement.props as any)?.className || ''} tooltip-trigger`.trim(),
          })
        )
      ) : (
        <span
          ref={setReference}
          {...getReferenceProps()}
          className="tooltip-trigger"
        >
          {triggerElement}
        </span>
      )}
      <FloatingPortal root={portalRoot}>
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
            <div className="tooltip-body">{renderContent()}</div>
          </div>
        )}
      </FloatingPortal>
    </>
  );
};

export default Tooltip;
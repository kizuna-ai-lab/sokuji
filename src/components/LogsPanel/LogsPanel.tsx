import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { ArrowRight, Terminal, Trash2, ArrowUp, ArrowDown, FastForward } from 'lucide-react';
import './LogsPanel.scss';
import { useLogData, useLogActions } from '../../stores/logStore';
import type { LogEntry } from '../../stores/logStore';
import { useTranslation } from 'react-i18next';

interface LogsPanelProps {
  toggleLogs: () => void;
}

// Memoized Event component with lazy JSON expansion
const Event: React.FC<{ logEntry: LogEntry }> = memo(({ logEntry }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [jsonString, setJsonString] = useState<string | null>(null);
  const { events, source, timestamp, eventType } = logEntry;

  if (!events || !events.length || !source) return null;

  const isClient = source === 'client';
  const eventTypeDisplay = eventType || t('logsPanel.unknown');
  const hasMultipleEvents = events.length > 1;
  
  // Get the latest event for display in collapsed view
  const latestEvent = events[events.length - 1];
  
  // Lazy load JSON string only when expanded
  useEffect(() => {
    if (isExpanded && !jsonString) {
      // Use setTimeout to avoid blocking the main thread
      const timer = setTimeout(() => {
        if (hasMultipleEvents) {
          const jsonArray = events.map(evt => JSON.stringify(evt, null, 2));
          setJsonString(jsonArray.join('\n---\n'));
        } else {
          setJsonString(JSON.stringify(latestEvent, null, 2));
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, jsonString, events, latestEvent, hasMultipleEvents]);

  return (
    <div className="event-entry">
      <div
        className="event-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="log-timestamp">{timestamp}</span>
        {isClient ? (
          <ArrowUp className="client-icon" />
        ) : (
          <ArrowDown className="server-icon" />
        )}
        <div className="event-info">
          <span className="source-label">{isClient ? t('logsPanel.client') : t('logsPanel.server')}:</span>
          <span className="event-type">{eventTypeDisplay}</span>
          {hasMultipleEvents && (
            <span className="event-count">({events.length})</span>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="event-details">
          {hasMultipleEvents ? (
            <div className="grouped-events">
              {jsonString ? (
                jsonString.split('\n---\n').map((eventStr, index) => (
                  <div key={index} className="grouped-event">
                    <div className="grouped-event-header">
                      <span className="grouped-event-index">{t('logsPanel.event')} {index + 1} {t('logsPanel.of')} {events.length}</span>
                    </div>
                    <pre>{eventStr}</pre>
                  </div>
                ))
              ) : (
                <div className="grouped-event">
                  <pre>Loading...</pre>
                </div>
              )}
            </div>
          ) : (
            <pre>{jsonString || 'Loading...'}</pre>
          )}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for memo
  return (
    prevProps.logEntry.timestamp === nextProps.logEntry.timestamp &&
    prevProps.logEntry.eventType === nextProps.logEntry.eventType &&
    prevProps.logEntry.source === nextProps.logEntry.source &&
    prevProps.logEntry.events?.length === nextProps.logEntry.events?.length
  );
});

// Constants for virtual scrolling
const ITEM_HEIGHT_ESTIMATE = 30; // Estimated height of each log item in pixels
const BUFFER_SIZE = 10; // Number of extra items to render outside viewport
const SCROLL_THROTTLE_MS = 16; // ~60fps

const LogsPanel: React.FC<LogsPanelProps> = ({ toggleLogs }) => {
  const { t } = useTranslation();
  const logs = useLogData();
  const { clearLogs } = useLogActions();
  const [autoScroll, setAutoScroll] = useState(true);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const logsContentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Calculate visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    if (!logsContentRef.current) return;
    
    const container = logsContentRef.current;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT_ESTIMATE) - BUFFER_SIZE);
    const end = Math.min(
      logs.length,
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT_ESTIMATE) + BUFFER_SIZE
    );
    
    setVisibleRange({ start, end });
  }, [logs.length]);
  
  // Throttled scroll handler
  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      updateVisibleRange();
      
      // Check if user scrolled to bottom
      if (logsContentRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = logsContentRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
        setAutoScroll(isAtBottom);
      }
    }, SCROLL_THROTTLE_MS);
  }, [updateVisibleRange]);
  
  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (autoScroll && logsContentRef.current) {
      const { current } = logsContentRef;
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        current.scrollTop = current.scrollHeight;
      });
    }
  }, [logs.length, autoScroll]); // Only depend on logs.length, not the entire array
  
  // Update visible range on mount and resize
  useEffect(() => {
    updateVisibleRange();
    
    const resizeObserver = new ResizeObserver(() => {
      updateVisibleRange();
    });
    
    if (logsContentRef.current) {
      resizeObserver.observe(logsContentRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [updateVisibleRange]);

  // Function to toggle auto-scroll
  const toggleAutoScroll = useCallback(() => {
    setAutoScroll(prev => !prev);
  }, []);

  // Memoized function to render regular log entry
  const renderLogEntry = useCallback((log: LogEntry, index: number) => {
    const elements: React.ReactNode[] = [];
    
    // Check if this is a session end marker
    const isSessionEnd = log.eventType === 'session.closed' || 
                        (log.message && log.message.includes('session.closed'));
    
    // Render the log entry itself
    if (log.events && log.events.length > 0 && log.source) {
      elements.push(<Event key={`event-${index}`} logEntry={log} />);
    } else {
      // Regular application log
      elements.push(
        <div className={`log-entry ${log.type || ''}`} key={`log-${index}`}>
          <span className="log-timestamp">{log.timestamp}</span>
          <span className="log-message">{log.message}</span>
        </div>
      );
    }
    
    // Add session separator after session end
    if (isSessionEnd) {
      elements.push(
        <div key={`separator-${index}`} className="session-separator">
          <div className="separator-line"></div>
          <span className="separator-text">{t('logsPanel.sessionEnded')}</span>
          <div className="separator-line"></div>
        </div>
      );
    }
    
    return <React.Fragment key={`fragment-${index}`}>{elements}</React.Fragment>;
  }, [t]);
  
  // Memoize visible logs
  const visibleLogs = useMemo(() => {
    return logs.slice(visibleRange.start, visibleRange.end);
  }, [logs, visibleRange]);
  
  // Calculate spacers for virtual scrolling
  const spacerTop = useMemo(() => {
    return visibleRange.start * ITEM_HEIGHT_ESTIMATE;
  }, [visibleRange.start]);
  
  const spacerBottom = useMemo(() => {
    return (logs.length - visibleRange.end) * ITEM_HEIGHT_ESTIMATE;
  }, [logs.length, visibleRange.end]);

  return (
    <div className="logs-panel">
      <div className="logs-panel-header">
        <h2>{t('logsPanel.title')}</h2>
        <div className="header-actions">
          <button 
            className={`auto-scroll-button ${autoScroll ? 'active' : ''}`} 
            onClick={toggleAutoScroll}
            title={autoScroll ? t('logsPanel.disableAutoScroll') : t('logsPanel.enableAutoScroll')}
          >
            <FastForward size={16} />
            <span>{autoScroll ? t('logsPanel.autoScrollOn') : t('logsPanel.autoScrollOff')}</span>
          </button>
          {logs.length > 0 && (
            <button className="clear-logs-button" onClick={clearLogs}>
              <Trash2 size={16} />
              <span>{t('common.clear')}</span>
            </button>
          )}
          <button className="close-logs-button" onClick={toggleLogs}>
            <ArrowRight size={16} />
            <span>{t('common.close')}</span>
          </button>
        </div>
      </div>
      <div className="logs-content" ref={logsContentRef} onScroll={handleScroll}>
        {logs.length > 0 ? (
          <>
            {/* Top spacer for virtual scrolling */}
            {spacerTop > 0 && <div style={{ height: spacerTop }} />}
            
            {/* Render only visible logs */}
            {visibleLogs.map((log, index) => 
              renderLogEntry(log, visibleRange.start + index)
            )}
            
            {/* Bottom spacer for virtual scrolling */}
            {spacerBottom > 0 && <div style={{ height: spacerBottom }} />}
          </>
        ) : (
          <div className="logs-placeholder">
            <div className="placeholder-content">
              <div className="icon-container">
                <Terminal size={24} />
              </div>
              <span>{t('logsPanel.logsPlaceholder')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsPanel;

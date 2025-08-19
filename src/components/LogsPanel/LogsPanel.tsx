import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, Terminal, Trash2, ArrowUp, ArrowDown, FastForward } from 'lucide-react';
import './LogsPanel.scss';
import { useLog, LogEntry } from '../../contexts/LogContext';
import { useTranslation } from 'react-i18next';

interface LogsPanelProps {
  toggleLogs: () => void;
}

// Event component to display OpenAI Realtime API events
const Event: React.FC<{ logEntry: LogEntry }> = ({ logEntry }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const { events, source, timestamp, eventType } = logEntry;

  if (!events || !events.length || !source) return null;

  const isClient = source === 'client';
  const eventTypeDisplay = eventType || t('logsPanel.unknown');
  const hasMultipleEvents = events.length > 1;
  
  // Get the latest event for display in collapsed view
  const latestEvent = events[events.length - 1];

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
              {events.map((evt, index) => (
                <div key={index} className="grouped-event">
                  <div className="grouped-event-header">
                    <span className="grouped-event-index">{t('logsPanel.event')} {index + 1} {t('logsPanel.of')} {events.length}</span>
                  </div>
                  <pre>{JSON.stringify(evt, null, 2)}</pre>
                </div>
              ))}
            </div>
          ) : (
            <pre>{JSON.stringify(latestEvent, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
};

const LogsPanel: React.FC<LogsPanelProps> = ({ toggleLogs }) => {
  const { t } = useTranslation();
  const { logs, clearLogs } = useLog();
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (autoScroll && logsContentRef.current) {
      const { current } = logsContentRef;
      current.scrollTop = current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Function to toggle auto-scroll
  const toggleAutoScroll = () => {
    setAutoScroll(!autoScroll);
  };

  // Function to render regular log entry with appropriate styling based on type
  const renderLogEntry = (log: LogEntry, index: number) => {
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
  };

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
      <div className="logs-content" ref={logsContentRef}>
        {logs.length > 0 ? (
          logs.map(renderLogEntry)
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

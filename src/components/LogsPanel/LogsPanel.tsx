import React, { useState } from 'react';
import { ArrowRight, Terminal, Trash2, ArrowUp, ArrowDown } from 'react-feather';
import './LogsPanel.scss';
import { useLog, LogEntry } from '../../contexts/LogContext';
import SampleEvents from './SampleEvents';

interface LogsPanelProps {
  toggleLogs: () => void;
}

// Event component to display OpenAI Realtime API events
const Event: React.FC<{ logEntry: LogEntry }> = ({ logEntry }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { event, source, timestamp, eventType } = logEntry;

  if (!event || !source) return null;

  const isClient = source === 'client';
  const eventTypeDisplay = eventType || 'unknown';

  return (
    <div className="event-entry">
      <div
        className="event-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="log-timestamp">{timestamp}</span>
        {isClient ? (
          <ArrowDown className="client-icon" />
        ) : (
          <ArrowUp className="server-icon" />
        )}
        <div className="event-info">
          <span className="source-label">{isClient ? "client:" : "server:"}</span>
          <span className="event-type">{eventTypeDisplay}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="event-details">
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

const LogsPanel: React.FC<LogsPanelProps> = ({ toggleLogs }) => {
  const { logs, clearLogs } = useLog();

  // Function to render regular log entry with appropriate styling based on type
  const renderLogEntry = (log: LogEntry, index: number) => {
    // If this is an OpenAI Realtime API event
    if (log.event && log.source) {
      return <Event key={index} logEntry={log} />;
    }

    // Regular application log
    return (
      <div className={`log-entry ${log.type || ''}`} key={index}>
        <span className="log-timestamp">{log.timestamp}</span>
        <span className="log-message">{log.message}</span>
      </div>
    );
  };

  return (
    <div className="logs-panel">
      <div className="logs-panel-header">
        <h2>Logs</h2>
        <div className="header-actions">
          {logs.length > 0 && (
            <button className="clear-logs-button" onClick={clearLogs}>
              <Trash2 size={16} />
              <span>Clear</span>
            </button>
          )}
          <button className="close-logs-button" onClick={toggleLogs}>
            <ArrowRight size={16} />
            <span>Close</span>
          </button>
        </div>
      </div>
      <div className="logs-content">
        {logs.length > 0 ? (
          logs.map(renderLogEntry)
        ) : (
          <div className="logs-placeholder">
            <div className="placeholder-content">
              <div className="icon-container">
                <Terminal size={24} />
              </div>
              <span>Logs will appear here</span>
            </div>
          </div>
        )}
      </div>
      {/* <SampleEvents /> */}
    </div>
  );
};

export default LogsPanel;

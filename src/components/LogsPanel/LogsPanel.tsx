import React from 'react';
import { ArrowRight, Terminal, Trash2 } from 'react-feather';
import './LogsPanel.scss';
import { useLog, LogEntry } from '../../contexts/LogContext';

interface LogsPanelProps {
  toggleLogs: () => void;
}

const LogsPanel: React.FC<LogsPanelProps> = ({ toggleLogs }) => {
  const { logs, clearLogs } = useLog();

  // Function to render log entry with appropriate styling based on type
  const renderLogEntry = (log: LogEntry, index: number) => {
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
    </div>
  );
};

export default LogsPanel;

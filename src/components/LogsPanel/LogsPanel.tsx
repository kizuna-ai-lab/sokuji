import React from 'react';
import { ArrowRight, Terminal } from 'react-feather';
import './LogsPanel.scss';

interface LogsPanelProps {
  toggleLogs: () => void;
}

// Define the log entry type
interface LogEntry {
  timestamp: string;
  message: string;
}

const LogsPanel: React.FC<LogsPanelProps> = ({ toggleLogs }) => {
  // Sample logs data with explicit type
  const logs: LogEntry[] = [
    { timestamp: '23:45:32', message: 'Session started' },
    { timestamp: '23:45:33', message: 'Connecting to OpenAI Realtime API' },
    { timestamp: '23:45:34', message: 'Using model: gpt-4o-mini-realtime-preview' },
    { timestamp: '23:45:35', message: 'Audio input device initialized' },
    { timestamp: '23:45:36', message: 'Ready to process audio' }
  ];

  return (
    <div className="logs-panel">
      <div className="logs-panel-header">
        <h2>Logs</h2>
        <button className="close-logs-button" onClick={toggleLogs}>
          <ArrowRight size={16} />
          <span>Close</span>
        </button>
      </div>
      <div className="logs-content">
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div className="log-entry" key={index}>
              <span className="log-timestamp">{log.timestamp}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
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

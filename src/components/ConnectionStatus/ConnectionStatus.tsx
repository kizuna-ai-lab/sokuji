import React from 'react';
import { Wifi, WifiOff, Loader, AlertCircle, CheckCircle2 } from 'lucide-react';
import './ConnectionStatus.scss';
import { useTranslation } from 'react-i18next';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'no-api-key' | 'no-mic';

interface ConnectionStatusProps {
  state: ConnectionState;
  message?: string;
  compact?: boolean;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ state, message, compact = false }) => {
  const { t } = useTranslation();

  const getStateInfo = () => {
    switch (state) {
      case 'disconnected':
        return {
          icon: <WifiOff size={compact ? 16 : 24} />,
          label: t('connectionStatus.disconnected', 'Disconnected'),
          color: 'disconnected',
          animate: false
        };
      case 'connecting':
        return {
          icon: <Loader size={compact ? 16 : 24} />,
          label: t('connectionStatus.connecting', 'Connecting...'),
          color: 'connecting',
          animate: true
        };
      case 'connected':
        return {
          icon: <CheckCircle2 size={compact ? 16 : 24} />,
          label: t('connectionStatus.connected', 'Connected'),
          color: 'connected',
          animate: 'pulse'
        };
      case 'error':
        return {
          icon: <AlertCircle size={compact ? 16 : 24} />,
          label: t('connectionStatus.error', 'Connection Error'),
          color: 'error',
          animate: false
        };
      case 'no-api-key':
        return {
          icon: <AlertCircle size={compact ? 16 : 24} />,
          label: t('connectionStatus.noApiKey', 'API Key Required'),
          color: 'warning',
          animate: false
        };
      case 'no-mic':
        return {
          icon: <AlertCircle size={compact ? 16 : 24} />,
          label: t('connectionStatus.noMic', 'Microphone Required'),
          color: 'warning',
          animate: false
        };
    }
  };

  const stateInfo = getStateInfo();

  return (
    <div className={`connection-status ${stateInfo.color} ${compact ? 'compact' : ''} ${stateInfo.animate === true ? 'animate-spin' : stateInfo.animate === 'pulse' ? 'animate-pulse' : ''}`}>
      <div className="status-icon">
        {stateInfo.icon}
      </div>
      {!compact && (
        <div className="status-info">
          <div className="status-label">{stateInfo.label}</div>
          {message && <div className="status-message">{message}</div>}
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;
/**
 * Windows Installation Guide Page
 */

import { ExternalLink, Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

export function WindowsInstall() {
  const { t } = useI18n();

  return (
    <div className="docs-content install-page">
      <h1>{t('install.windows')}</h1>

      <p className="install-page__overview">
        This guide will walk you through installing Sokuji on Windows systems.
        Sokuji is available as a .exe installer for easy installation on Windows 10 and Windows 11.
      </p>

      <a
        href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="install-page__download-btn"
      >
        <Download size={20} />
        Download for Windows
        <ExternalLink size={16} />
      </a>

      {/* System Requirements */}
      <div className="install-page__requirements">
        <h3>System Requirements</h3>
        <ul>
          <li>Windows 10 (version 1903 or later) or Windows 11</li>
          <li>64-bit processor</li>
          <li>4GB RAM minimum (8GB recommended)</li>
          <li>200MB available disk space</li>
          <li>Internet connection for AI translation services</li>
          <li>Microphone and speakers/headphones</li>
        </ul>
      </div>

      {/* Step 1 */}
      <h2>Installation Steps</h2>

      <div className="install-page__step">
        <h3>Step 1: Download Sokuji</h3>
        <p>
          Visit the{' '}
          <a
            href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
          >
            official GitHub releases page
          </a>{' '}
          to download the latest version of Sokuji for Windows.
        </p>
        <p>Choose the right installer:</p>
        <ul>
          <li><strong>.exe installer</strong> - Standard installer for Windows</li>
          <li><strong>Portable version</strong> - No installation required (if available)</li>
        </ul>
      </div>

      {/* Step 2 */}
      <div className="install-page__step">
        <h3>Step 2: Run the Installer</h3>
        <p>Once downloaded, locate the installer file and run it to begin installation.</p>

        <h4>Windows Defender SmartScreen</h4>
        <p>
          When you run the installer, Windows Defender SmartScreen may prevent the app from starting:
        </p>
        <ol>
          <li>Click <strong>"More info"</strong> on the SmartScreen warning</li>
          <li>Click <strong>"Run anyway"</strong> to proceed with the installation</li>
        </ol>

        <div className="install-page__warning">
          Windows may show security warnings for unsigned applications. Sokuji is safe to install.
          These warnings appear because the app is not yet signed with a commercial certificate.
        </div>
      </div>

      {/* Step 3 */}
      <div className="install-page__step">
        <h3>Step 3: Install VB-CABLE Virtual Audio Device</h3>
        <p>
          Sokuji requires VB-CABLE virtual audio device to route audio to other applications.
          The installer will prompt you to install it automatically.
        </p>

        <h4>VB-CABLE Installation</h4>
        <ol>
          <li>Click <strong>"Install Now"</strong> to automatically download and install VB-CABLE</li>
          <li>
            Alternatively, you can click "Download Manually" to get it from{' '}
            <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">
              vb-audio.com/Cable
            </a>
          </li>
          <li>When the User Account Control prompt appears, click <strong>"Yes"</strong></li>
          <li>VB-CABLE installer will open. Click <strong>"Install Driver"</strong></li>
          <li>Wait for installation to complete and click <strong>"OK"</strong></li>
        </ol>

        <div className="install-page__info">
          VB-CABLE creates virtual audio devices that allow Sokuji to pass translated audio to
          video conferencing applications like Zoom, Teams, or Google Meet.
        </div>
      </div>

      {/* Step 4 */}
      <div className="install-page__step">
        <h3>Step 4: First Run Setup</h3>
        <p>After VB-CABLE installation, Sokuji will launch automatically.</p>

        <h4>Verify Audio Devices</h4>
        <p>In the Audio Settings panel, you should see:</p>
        <ul>
          <li><strong>CABLE Output (VB-Audio Virtual Cable)</strong> - Listed under Available Input Devices</li>
          <li><strong>CABLE Input (VB-Audio Virtual Cable)</strong> - Listed under Available Monitor Devices</li>
        </ul>
        <p>These virtual devices confirm that VB-CABLE was installed successfully.</p>

        <h4>Complete Setup</h4>
        <ol>
          <li>Configure your preferred AI provider (OpenAI, Google Gemini, etc.)</li>
          <li>Enter your API key for the selected provider</li>
          <li>Select source and target languages</li>
          <li>Test the audio input/output devices</li>
          <li>Select your physical microphone as the Audio Input Device</li>
          <li>Choose your speakers/headphones as the Virtual Speaker Monitor Device</li>
        </ol>

        <div className="install-page__success">
          Sokuji is now ready to use! You can start real-time translation by clicking the start session button.
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="install-page__troubleshooting">
        <h2>Troubleshooting</h2>

        <div className="install-page__issue">
          <h3>Windows Defender blocks the installation</h3>
          <ol>
            <li>Click "More info" on the SmartScreen warning</li>
            <li>Click "Run anyway" to proceed with installation</li>
          </ol>
          <p>This is a common issue with unsigned applications and does not indicate a security problem.</p>
        </div>

        <div className="install-page__issue">
          <h3>Microphone not detected</h3>
          <ol>
            <li>Open Windows Settings → Privacy → Microphone</li>
            <li>Ensure "Allow apps to access your microphone" is enabled</li>
            <li>Make sure Sokuji is listed and enabled in the app list</li>
            <li>Check your microphone is properly connected and set as default device</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>No audio output</h3>
          <ol>
            <li>Right-click the speaker icon in system tray</li>
            <li>Select "Open Sound settings"</li>
            <li>Verify your output device is correctly selected</li>
            <li>Check the volume levels are not muted</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>VB-CABLE devices not detected</h3>
          <ol>
            <li><strong>Restart your computer</strong> - This often resolves device recognition issues</li>
            <li>
              <strong>Check Windows Sound Settings</strong>:
              <ul>
                <li>Right-click the speaker icon in system tray</li>
                <li>Select "Sound settings"</li>
                <li>Look for "CABLE Input" in playback devices</li>
                <li>Look for "CABLE Output" in recording devices</li>
              </ul>
            </li>
            <li>
              <strong>Manually reinstall VB-CABLE</strong>:
              <ul>
                <li>Download from <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">vb-audio.com/Cable</a></li>
                <li>Extract the ZIP file</li>
                <li>Run VBCABLE_Setup_x64.exe as Administrator</li>
                <li>Restart your computer after installation</li>
              </ul>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

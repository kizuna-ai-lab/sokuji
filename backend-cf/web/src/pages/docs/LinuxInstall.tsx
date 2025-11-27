/**
 * Linux Installation Guide Page
 */

import { ExternalLink, Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

export function LinuxInstall() {
  const { t } = useI18n();

  return (
    <div className="docs-content install-page">
      <h1>{t('install.linux')}</h1>

      <p className="install-page__overview">
        This guide will walk you through installing Sokuji on Linux systems.
        Sokuji is available as a .deb package for Debian/Ubuntu-based distributions.
      </p>

      <a
        href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="install-page__download-btn"
      >
        <Download size={20} />
        Download for Linux
        <ExternalLink size={16} />
      </a>

      {/* System Requirements */}
      <div className="install-page__requirements">
        <h3>System Requirements</h3>
        <ul>
          <li>Ubuntu 20.04 LTS or later, or Debian 11 or later</li>
          <li>64-bit processor (x86_64/amd64)</li>
          <li>4GB RAM minimum (8GB recommended)</li>
          <li>200MB available disk space</li>
          <li>Internet connection for AI translation services</li>
          <li>PulseAudio or PipeWire audio server</li>
          <li>Microphone and speakers/headphones</li>
        </ul>
      </div>

      {/* Installation Steps */}
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
          to download the latest .deb package for Linux.
        </p>
        <p>Or download using wget:</p>
        <pre><code>wget https://github.com/kizuna-ai-lab/sokuji/releases/latest/download/sokuji_amd64.deb</code></pre>
      </div>

      <div className="install-page__step">
        <h3>Step 2: Install the Package</h3>
        <p>Install using dpkg:</p>
        <pre><code>sudo dpkg -i sokuji_amd64.deb</code></pre>
        <p>If there are dependency issues, run:</p>
        <pre><code>sudo apt-get install -f</code></pre>
        <p>Or install using apt directly:</p>
        <pre><code>sudo apt install ./sokuji_amd64.deb</code></pre>
      </div>

      <div className="install-page__step">
        <h3>Step 3: Set Up Virtual Audio Device (Optional)</h3>
        <p>
          For Linux, Sokuji can use PulseAudio/PipeWire virtual sinks for audio routing.
          This is handled automatically by the application when available.
        </p>

        <h4>Manual PulseAudio Virtual Sink Setup</h4>
        <p>If needed, you can create a virtual sink manually:</p>
        <pre><code>{`# Load the null sink module
pactl load-module module-null-sink sink_name=sokuji_virtual sink_properties=device.description="Sokuji_Virtual"

# Create a virtual source from the sink's monitor
pactl load-module module-virtual-source source_name=sokuji_source master=sokuji_virtual.monitor source_properties=device.description="Sokuji_Microphone"`}</code></pre>

        <div className="install-page__info">
          The virtual audio device allows Sokuji to pass translated audio to video conferencing
          applications. Select "Sokuji_Microphone" as your microphone in the application.
        </div>
      </div>

      <div className="install-page__step">
        <h3>Step 4: Launch Sokuji</h3>
        <p>Launch from the application menu or run:</p>
        <pre><code>sokuji</code></pre>

        <h4>Complete Setup</h4>
        <ol>
          <li>Configure your preferred AI provider (OpenAI, Google Gemini, etc.)</li>
          <li>Enter your API key for the selected provider</li>
          <li>Select source and target languages</li>
          <li>Select your physical microphone as the Audio Input Device</li>
          <li>Choose your speakers/headphones as the output device</li>
        </ol>

        <div className="install-page__success">
          Sokuji is now ready to use! You can start real-time translation by clicking the start session button.
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="install-page__troubleshooting">
        <h2>Troubleshooting</h2>

        <div className="install-page__issue">
          <h3>Application won't start</h3>
          <ul>
            <li>Check if you have the required dependencies installed</li>
            <li>Run from terminal to see error messages: <code>sokuji</code></li>
            <li>Ensure you have PulseAudio or PipeWire running</li>
          </ul>
        </div>

        <div className="install-page__issue">
          <h3>Microphone not detected</h3>
          <ol>
            <li>Check if your microphone is connected and recognized by the system</li>
            <li>Run <code>pactl list sources</code> to see available audio sources</li>
            <li>Make sure the application has permission to access the microphone</li>
            <li>If using Flatpak/Snap, ensure audio permissions are granted</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>No audio output</h3>
          <ol>
            <li>Check your audio output device is correctly selected</li>
            <li>Run <code>pactl list sinks</code> to see available audio outputs</li>
            <li>Verify volume levels using <code>pavucontrol</code> or your desktop's audio settings</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>Virtual audio device not working</h3>
          <ol>
            <li>Ensure PulseAudio/PipeWire is running: <code>pulseaudio --check && echo "Running"</code></li>
            <li>Restart PulseAudio: <code>pulseaudio -k && pulseaudio --start</code></li>
            <li>Check if the virtual sink was created: <code>pactl list sinks short</code></li>
            <li>For PipeWire users, ensure pipewire-pulse is installed</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>Dependency issues during installation</h3>
          <pre><code>sudo apt-get update && sudo apt-get install -f</code></pre>
          <p>This will install any missing dependencies required by Sokuji.</p>
        </div>
      </div>
    </div>
  );
}

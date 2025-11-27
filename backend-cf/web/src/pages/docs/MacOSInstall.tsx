/**
 * macOS Installation Guide Page
 */

import { ExternalLink, Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

export function MacOSInstall() {
  const { t } = useI18n();

  return (
    <div className="docs-content install-page">
      <h1>{t('install.macos')}</h1>

      <p className="install-page__overview">
        This guide will walk you through installing Sokuji on macOS.
        Sokuji is available as a .pkg installer for easy installation on macOS 11 (Big Sur) and later.
      </p>

      <a
        href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="install-page__download-btn"
      >
        <Download size={20} />
        Download for macOS
        <ExternalLink size={16} />
      </a>

      {/* System Requirements */}
      <div className="install-page__requirements">
        <h3>System Requirements</h3>
        <ul>
          <li>macOS 11 (Big Sur) or later</li>
          <li>Apple Silicon (M1/M2/M3) or Intel processor</li>
          <li>4GB RAM minimum (8GB recommended)</li>
          <li>200MB available disk space</li>
          <li>Internet connection for AI translation services</li>
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
          to download the latest .pkg installer for macOS.
        </p>
        <p>Download the appropriate version for your Mac:</p>
        <ul>
          <li><strong>Universal (recommended)</strong> - Works on both Apple Silicon and Intel Macs</li>
          <li><strong>ARM64</strong> - Optimized for Apple Silicon (M1/M2/M3)</li>
          <li><strong>x64</strong> - For Intel-based Macs</li>
        </ul>
      </div>

      <div className="install-page__step">
        <h3>Step 2: Run the Installer</h3>
        <p>Double-click the downloaded .pkg file to start the installer.</p>

        <h4>Gatekeeper Warning</h4>
        <p>macOS may show a warning that the app is from an unidentified developer:</p>
        <ol>
          <li>Open <strong>System Preferences</strong> → <strong>Security & Privacy</strong></li>
          <li>Click the <strong>General</strong> tab</li>
          <li>Click <strong>"Open Anyway"</strong> next to the blocked app message</li>
          <li>Alternatively, right-click the .pkg file and select <strong>"Open"</strong></li>
        </ol>

        <div className="install-page__warning">
          macOS shows this warning for apps downloaded from the internet that aren't from the Mac App Store.
          Sokuji is safe to install. These warnings appear because the app is not yet notarized.
        </div>
      </div>

      <div className="install-page__step">
        <h3>Step 3: Complete Installation</h3>
        <ol>
          <li>Follow the installer prompts</li>
          <li>Enter your password when prompted for administrator privileges</li>
          <li>Wait for the installation to complete</li>
          <li>The installer will add Sokuji to your Applications folder</li>
        </ol>
      </div>

      <div className="install-page__step">
        <h3>Step 4: Grant Permissions</h3>
        <p>When you first launch Sokuji, macOS will ask for microphone permissions:</p>
        <ol>
          <li>Click <strong>"OK"</strong> when prompted to allow microphone access</li>
          <li>If you accidentally denied permission, go to:
            <ul>
              <li><strong>System Preferences</strong> → <strong>Security & Privacy</strong> → <strong>Privacy</strong></li>
              <li>Select <strong>Microphone</strong> from the left sidebar</li>
              <li>Check the box next to <strong>Sokuji</strong></li>
            </ul>
          </li>
        </ol>

        <div className="install-page__info">
          Microphone access is required for Sokuji to capture your voice for real-time translation.
          Sokuji does not store or transmit your audio recordings.
        </div>
      </div>

      <div className="install-page__step">
        <h3>Step 5: First Run Setup</h3>
        <p>Launch Sokuji from your Applications folder or using Spotlight (Cmd + Space, then type "Sokuji").</p>

        <h4>Complete Setup</h4>
        <ol>
          <li>Configure your preferred AI provider (OpenAI, Google Gemini, etc.)</li>
          <li>Enter your API key for the selected provider</li>
          <li>Select source and target languages</li>
          <li>Select your microphone as the Audio Input Device</li>
          <li>Choose your speakers/headphones as the output device</li>
        </ol>

        <div className="install-page__success">
          Sokuji is now ready to use! You can start real-time translation by clicking the start session button.
        </div>
      </div>

      {/* Virtual Audio Setup */}
      <h2>Virtual Audio Device Setup (Optional)</h2>

      <div className="install-page__step">
        <h3>Setting Up BlackHole</h3>
        <p>
          For routing translated audio to video conferencing apps, you can use BlackHole,
          a free virtual audio driver for macOS.
        </p>
        <ol>
          <li>
            Download BlackHole from{' '}
            <a href="https://existential.audio/blackhole/" target="_blank" rel="noopener noreferrer">
              existential.audio/blackhole
            </a>
          </li>
          <li>Install BlackHole 2ch (recommended for most use cases)</li>
          <li>Restart your computer after installation</li>
          <li>In your video conferencing app, select "BlackHole 2ch" as your microphone</li>
          <li>In Sokuji, select "BlackHole 2ch" as the output device</li>
        </ol>

        <div className="install-page__info">
          BlackHole allows Sokuji to send translated audio directly to apps like Zoom, Teams, or Google Meet.
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="install-page__troubleshooting">
        <h2>Troubleshooting</h2>

        <div className="install-page__issue">
          <h3>"App is damaged" or can't be opened</h3>
          <p>This is a Gatekeeper security feature. Try these solutions:</p>
          <ol>
            <li>Right-click the app and select "Open" from the context menu</li>
            <li>
              Or run in Terminal:
              <pre><code>xattr -cr /Applications/Sokuji.app</code></pre>
            </li>
            <li>Then try opening the app again</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>Microphone not working</h3>
          <ol>
            <li>Go to <strong>System Preferences</strong> → <strong>Security & Privacy</strong> → <strong>Privacy</strong></li>
            <li>Select <strong>Microphone</strong></li>
            <li>Make sure Sokuji is checked in the list</li>
            <li>If not listed, try quitting and reopening Sokuji</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>No audio output</h3>
          <ol>
            <li>Check that your output device is correctly selected in Sokuji</li>
            <li>Verify your Mac's volume is not muted</li>
            <li>Try selecting a different output device</li>
            <li>Restart Sokuji if audio issues persist</li>
          </ol>
        </div>

        <div className="install-page__issue">
          <h3>App crashes on Apple Silicon</h3>
          <ul>
            <li>Make sure you're using the latest version of Sokuji</li>
            <li>Check if Rosetta 2 is installed (required for some versions)</li>
            <li>Try downloading the Universal or ARM64 specific version</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

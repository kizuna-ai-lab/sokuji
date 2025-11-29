/**
 * Windows Installation Guide Page
 * Content synced from docs/tutorials/windows-install.html
 */

import { useState } from 'react';
import { ExternalLink, Download } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import { Lightbox } from '@/components/docs/Lightbox';
import './docs.scss';

interface Subsection {
  title: string;
  content: string;
}

interface Step {
  title: string;
  content: string;
  subsections?: Subsection[];
  warning?: string;
  info?: string;
  success?: string;
}

interface TroubleshootingIssue {
  title: string;
  content: string;
}

interface WindowsInstallData {
  pageTitle: string;
  overview: string;
  downloadButton: string;
  requirements: {
    title: string;
    items: string[];
  };
  steps: Step[];
  troubleshooting: {
    title: string;
    issues: TroubleshootingIssue[];
  };
}

const translations: Record<Locale, WindowsInstallData> = {
  en: {
    pageTitle: 'Windows Installation Guide',
    overview:
      'This guide will walk you through installing Sokuji on Windows systems. Sokuji is available as a .exe installer for easy installation on Windows 10 and Windows 11.',
    downloadButton: 'Download for Windows',
    requirements: {
      title: 'System Requirements',
      items: [
        'Windows 10 (version 1903 or later) or Windows 11',
        '64-bit processor',
        '4GB RAM minimum (8GB recommended)',
        '200MB available disk space',
        'Internet connection for AI translation services',
        'Microphone and speakers/headphones',
      ],
    },
    steps: [
      {
        title: 'Step 1: Download Sokuji',
        content: `Visit the <a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">official GitHub releases page</a> to download the latest version of Sokuji for Windows.`,
        subsections: [
          {
            title: 'Choose the Right Installer',
            content: `<ul>
              <li><strong>.exe installer</strong> - Standard installer for Windows</li>
              <li><strong>Portable version</strong> - No installation required (if available)</li>
            </ul>`,
          },
        ],
      },
      {
        title: 'Step 2: Run the Installer',
        content: `Once downloaded, locate the installer file and run it to begin installation.`,
        subsections: [
          {
            title: 'Windows Defender SmartScreen',
            content: `<p>When you run the installer, Windows Defender SmartScreen may prevent the app from starting:</p>
            <img src="/tutorials/windows-install/1.png" alt="Windows Defender SmartScreen warning" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>Click <strong>"More info"</strong> on the SmartScreen warning</li>
              <li>The window will expand to show more details:</li>
            </ol>
            <img src="/tutorials/windows-install/2.png" alt="Windows Defender SmartScreen expanded view" class="install-page__screenshot" data-lightbox="true" />
            <ol start="3">
              <li>Click <strong>"Run anyway"</strong> to proceed with the installation</li>
            </ol>`,
          },
        ],
        warning:
          'Windows may show security warnings for unsigned applications. Sokuji is safe to install. These warnings appear because the app is not yet signed with a commercial certificate.',
      },
      {
        title: 'Step 3: Install VB-CABLE Virtual Audio Device',
        content: `Sokuji requires VB-CABLE virtual audio device to route audio to other applications. The installer will prompt you to install it automatically.`,
        subsections: [
          {
            title: 'VB-CABLE Installation',
            content: `<p>After bypassing SmartScreen, you'll see the VB-CABLE installation prompt:</p>
            <img src="/tutorials/windows-install/3.png" alt="VB-CABLE installation prompt" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>Click <strong>"Install Now"</strong> to automatically download and install VB-CABLE</li>
              <li>Alternatively, you can click "Download Manually" to get it from <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">vb-audio.com/Cable</a></li>
              <li>When the User Account Control prompt appears, click <strong>"Yes"</strong> to allow the installation:</li>
            </ol>
            <img src="/tutorials/windows-install/3.5.jpg" alt="User Account Control prompt for VB-CABLE" class="install-page__screenshot" data-lightbox="true" />
            <ol start="4">
              <li>The VB-CABLE installer will open. Click <strong>"Install Driver"</strong>:</li>
            </ol>
            <img src="/tutorials/windows-install/4.png" alt="VB-CABLE installer window" class="install-page__screenshot" data-lightbox="true" />
            <ol start="5">
              <li>Wait for the installation to complete. You'll see a success message:</li>
            </ol>
            <img src="/tutorials/windows-install/5.png" alt="VB-CABLE installation complete" class="install-page__screenshot" data-lightbox="true" />
            <ol start="6">
              <li>Click <strong>"OK"</strong> on the installation complete dialog</li>
              <li>The final confirmation will appear:</li>
            </ol>
            <img src="/tutorials/windows-install/6.png" alt="VB-CABLE installation success confirmation" class="install-page__screenshot" data-lightbox="true" />
            <ol start="8">
              <li>Click <strong>"OK"</strong> to finish the VB-CABLE installation</li>
            </ol>`,
          },
        ],
        info: 'VB-CABLE creates virtual audio devices that allow Sokuji to pass translated audio to video conferencing applications like Zoom, Teams, or Google Meet.',
      },
      {
        title: 'Step 4: First Run Setup',
        content: `After VB-CABLE installation, Sokuji will launch automatically and you'll see the audio configuration page:`,
        subsections: [
          {
            title: 'Verify Audio Devices',
            content: `<img src="/tutorials/windows-install/7.png" alt="Sokuji audio configuration showing VB-CABLE devices" class="install-page__screenshot" data-lightbox="true" />
            <p>In the Audio Settings panel, you should see:</p>
            <ul>
              <li><strong>CABLE Output (VB-Audio Virtual Cable)</strong> - Listed under Available Input Devices</li>
              <li><strong>CABLE Input (VB-Audio Virtual Cable)</strong> - Listed under Available Monitor Devices</li>
            </ul>
            <p>These virtual devices confirm that VB-CABLE was installed successfully.</p>`,
          },
          {
            title: 'Complete Setup',
            content: `<ol>
              <li>Configure your preferred AI provider (OpenAI, Google Gemini, etc.)</li>
              <li>Enter your API key for the selected provider</li>
              <li>Select source and target languages</li>
              <li>Test the audio input/output devices</li>
              <li>Select your physical microphone as the Audio Input Device</li>
              <li>Choose your speakers/headphones as the Virtual Speaker Monitor Device</li>
            </ol>`,
          },
        ],
        success:
          'Sokuji is now ready to use! You can start real-time translation by clicking the start session button.',
      },
    ],
    troubleshooting: {
      title: 'Troubleshooting',
      issues: [
        {
          title: 'Windows Defender blocks the installation',
          content: `If Windows Defender SmartScreen blocks the installation:
          <ol>
            <li>Click "More info" on the SmartScreen warning</li>
            <li>Click "Run anyway" to proceed with installation</li>
          </ol>
          This is a common issue with unsigned applications and does not indicate a security problem.`,
        },
        {
          title: 'Microphone not detected',
          content: `If your microphone is not detected:
          <ol>
            <li>Open Windows Settings → Privacy → Microphone</li>
            <li>Ensure "Allow apps to access your microphone" is enabled</li>
            <li>Make sure Sokuji is listed and enabled in the app list</li>
            <li>Check your microphone is properly connected and set as default device</li>
          </ol>`,
        },
        {
          title: 'No audio output',
          content: `If you're not hearing any audio:
          <ol>
            <li>Right-click the speaker icon in system tray</li>
            <li>Select "Open Sound settings"</li>
            <li>Verify your output device is correctly selected</li>
            <li>Check the volume levels are not muted</li>
          </ol>`,
        },
        {
          title: "Application won't start",
          content: `If Sokuji won't start:
          <ul>
            <li>Try running as Administrator (right-click → Run as administrator)</li>
            <li>Check if antivirus software is blocking the application</li>
            <li>Reinstall the application</li>
            <li>Ensure you have the latest Windows updates installed</li>
          </ul>`,
        },
        {
          title: 'VB-CABLE devices not detected',
          content: `If you don't see CABLE Output/Input devices in Sokuji:
          <ol>
            <li><strong>Restart your computer</strong> - This often resolves device recognition issues</li>
            <li><strong>Check Windows Sound Settings</strong>:
              <ul>
                <li>Right-click the speaker icon in system tray</li>
                <li>Select "Sound settings"</li>
                <li>Look for "CABLE Input" in playback devices</li>
                <li>Look for "CABLE Output" in recording devices</li>
              </ul>
            </li>
            <li><strong>Manually reinstall VB-CABLE</strong>:
              <ul>
                <li>Download from <a href="https://vb-audio.com/Cable/" target="_blank">vb-audio.com/Cable</a></li>
                <li>Extract the ZIP file</li>
                <li>Run VBCABLE_Setup_x64.exe as Administrator</li>
                <li>Restart your computer after installation</li>
              </ul>
            </li>
            <li><strong>Check Device Manager</strong>:
              <ul>
                <li>Open Device Manager (Win+X → Device Manager)</li>
                <li>Look under "Sound, video and game controllers"</li>
                <li>Verify "VB-Audio Virtual Cable" is listed without errors</li>
              </ul>
            </li>
          </ol>`,
        },
      ],
    },
  },
  zh: {
    pageTitle: 'Windows 安装指南',
    overview:
      '本指南将指导您在 Windows 系统上安装 Sokuji。Sokuji 提供 .exe 安装程序，可在 Windows 10 和 Windows 11 上轻松安装。',
    downloadButton: '下载 Windows 版',
    requirements: {
      title: '系统要求',
      items: [
        'Windows 10（1903版本或更高）或 Windows 11',
        '64位处理器',
        '最低4GB内存（推荐8GB）',
        '200MB可用磁盘空间',
        '用于AI翻译服务的互联网连接',
        '麦克风和扬声器/耳机',
      ],
    },
    steps: [
      {
        title: '步骤 1：下载 Sokuji',
        content: `访问 <a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">官方 GitHub 发布页面</a> 下载最新的 Windows 版本 Sokuji。`,
        subsections: [
          {
            title: '选择正确的安装程序',
            content: `<ul>
              <li><strong>.exe 安装程序</strong> - Windows 的标准安装程序</li>
              <li><strong>便携版</strong> - 无需安装（如果可用）</li>
            </ul>`,
          },
        ],
      },
      {
        title: '步骤 2：运行安装程序',
        content: `下载完成后，找到安装文件并运行它开始安装。`,
        subsections: [
          {
            title: 'Windows Defender SmartScreen',
            content: `<p>运行安装程序时，Windows Defender SmartScreen 可能会阻止应用启动：</p>
            <img src="/tutorials/windows-install/1.png" alt="Windows Defender SmartScreen 警告" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>点击 SmartScreen 警告上的<strong>"更多信息"</strong></li>
              <li>窗口将展开显示更多详情：</li>
            </ol>
            <img src="/tutorials/windows-install/2.png" alt="Windows Defender SmartScreen 展开视图" class="install-page__screenshot" data-lightbox="true" />
            <ol start="3">
              <li>点击<strong>"仍要运行"</strong>继续安装</li>
            </ol>`,
          },
        ],
        warning:
          'Windows 可能会对未签名的应用程序显示安全警告。Sokuji 是安全的。这些警告出现是因为该应用尚未使用商业证书签名。',
      },
      {
        title: '步骤 3：安装 VB-CABLE 虚拟音频设备',
        content: `Sokuji 需要 VB-CABLE 虚拟音频设备来将音频路由到其他应用程序。安装程序会提示您自动安装它。`,
        subsections: [
          {
            title: 'VB-CABLE 安装',
            content: `<p>绕过 SmartScreen 后，您会看到 VB-CABLE 安装提示：</p>
            <img src="/tutorials/windows-install/3.png" alt="VB-CABLE 安装提示" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>点击<strong>"Install Now"</strong>自动下载并安装 VB-CABLE</li>
              <li>或者，您可以点击"Download Manually"从 <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">vb-audio.com/Cable</a> 手动获取</li>
              <li>当用户账户控制提示出现时，点击<strong>"是"</strong>允许安装：</li>
            </ol>
            <img src="/tutorials/windows-install/3.5.jpg" alt="VB-CABLE 的用户账户控制提示" class="install-page__screenshot" data-lightbox="true" />
            <ol start="4">
              <li>VB-CABLE 安装程序将打开。点击<strong>"Install Driver"</strong>：</li>
            </ol>
            <img src="/tutorials/windows-install/4.png" alt="VB-CABLE 安装程序窗口" class="install-page__screenshot" data-lightbox="true" />
            <ol start="5">
              <li>等待安装完成。您会看到成功消息：</li>
            </ol>
            <img src="/tutorials/windows-install/5.png" alt="VB-CABLE 安装完成" class="install-page__screenshot" data-lightbox="true" />
            <ol start="6">
              <li>在安装完成对话框上点击<strong>"OK"</strong></li>
              <li>最终确认将出现：</li>
            </ol>
            <img src="/tutorials/windows-install/6.png" alt="VB-CABLE 安装成功确认" class="install-page__screenshot" data-lightbox="true" />
            <ol start="8">
              <li>点击<strong>"OK"</strong>完成 VB-CABLE 安装</li>
            </ol>`,
          },
        ],
        info: 'VB-CABLE 创建虚拟音频设备，允许 Sokuji 将翻译后的音频传递给 Zoom、Teams 或 Google Meet 等视频会议应用程序。',
      },
      {
        title: '步骤 4：首次运行设置',
        content: `VB-CABLE 安装后，Sokuji 将自动启动，您会看到音频配置页面：`,
        subsections: [
          {
            title: '验证音频设备',
            content: `<img src="/tutorials/windows-install/7.png" alt="显示 VB-CABLE 设备的 Sokuji 音频配置" class="install-page__screenshot" data-lightbox="true" />
            <p>在音频设置面板中，您应该看到：</p>
            <ul>
              <li><strong>CABLE Output (VB-Audio Virtual Cable)</strong> - 在可用输入设备中列出</li>
              <li><strong>CABLE Input (VB-Audio Virtual Cable)</strong> - 在可用监听设备中列出</li>
            </ul>
            <p>这些虚拟设备确认 VB-CABLE 已成功安装。</p>`,
          },
          {
            title: '完成设置',
            content: `<ol>
              <li>配置您首选的 AI 提供商（OpenAI、Google Gemini 等）</li>
              <li>输入所选提供商的 API 密钥</li>
              <li>选择源语言和目标语言</li>
              <li>测试音频输入/输出设备</li>
              <li>选择您的物理麦克风作为音频输入设备</li>
              <li>选择您的扬声器/耳机作为虚拟扬声器监听设备</li>
            </ol>`,
          },
        ],
        success: 'Sokuji 现在已准备就绪！您可以通过点击麦克风按钮开始实时翻译。',
      },
    ],
    troubleshooting: {
      title: '故障排除',
      issues: [
        {
          title: 'Windows Defender 阻止安装',
          content: `如果 Windows Defender SmartScreen 阻止安装：
          <ol>
            <li>在 SmartScreen 警告上点击"更多信息"</li>
            <li>点击"仍要运行"继续安装</li>
          </ol>
          这是未签名应用程序的常见问题，并不表示存在安全问题。`,
        },
        {
          title: '未检测到麦克风',
          content: `如果未检测到麦克风：
          <ol>
            <li>打开 Windows 设置 → 隐私 → 麦克风</li>
            <li>确保"允许应用访问麦克风"已启用</li>
            <li>确保 Sokuji 在应用列表中并已启用</li>
            <li>检查麦克风是否正确连接并设置为默认设备</li>
          </ol>`,
        },
        {
          title: '无音频输出',
          content: `如果听不到任何音频：
          <ol>
            <li>右键点击系统托盘中的扬声器图标</li>
            <li>选择"打开声音设置"</li>
            <li>验证输出设备是否正确选择</li>
            <li>检查音量级别是否未静音</li>
          </ol>`,
        },
        {
          title: '应用程序无法启动',
          content: `如果 Sokuji 无法启动：
          <ul>
            <li>尝试以管理员身份运行（右键 → 以管理员身份运行）</li>
            <li>检查防病毒软件是否阻止了应用程序</li>
            <li>重新安装应用程序</li>
            <li>确保已安装最新的 Windows 更新</li>
          </ul>`,
        },
        {
          title: '未检测到 VB-CABLE 设备',
          content: `如果在 Sokuji 中看不到 CABLE Output/Input 设备：
          <ol>
            <li><strong>重启计算机</strong> - 这通常可以解决设备识别问题</li>
            <li><strong>检查 Windows 声音设置</strong>：
              <ul>
                <li>右键点击系统托盘中的扬声器图标</li>
                <li>选择"声音设置"</li>
                <li>在播放设备中查找"CABLE Input"</li>
                <li>在录制设备中查找"CABLE Output"</li>
              </ul>
            </li>
            <li><strong>手动重新安装 VB-CABLE</strong>：
              <ul>
                <li>从 <a href="https://vb-audio.com/Cable/" target="_blank">vb-audio.com/Cable</a> 下载</li>
                <li>解压 ZIP 文件</li>
                <li>以管理员身份运行 VBCABLE_Setup_x64.exe</li>
                <li>安装后重启计算机</li>
              </ul>
            </li>
            <li><strong>检查设备管理器</strong>：
              <ul>
                <li>打开设备管理器（Win+X → 设备管理器）</li>
                <li>在"声音、视频和游戏控制器"下查看</li>
                <li>验证"VB-Audio Virtual Cable"是否列出且无错误</li>
              </ul>
            </li>
          </ol>`,
        },
      ],
    },
  },
  ja: {
    pageTitle: 'Windows インストールガイド',
    overview:
      'このガイドでは、Windows システムに Sokuji をインストールする方法を説明します。Sokuji は Windows 10 と Windows 11 で簡単にインストールできる .exe インストーラーとして提供されています。',
    downloadButton: 'Windows 版をダウンロード',
    requirements: {
      title: 'システム要件',
      items: [
        'Windows 10（バージョン1903以降）またはWindows 11',
        '64ビットプロセッサ',
        '最小4GBのRAM（8GB推奨）',
        '200MBの空きディスク容量',
        'AI翻訳サービス用のインターネット接続',
        'マイクとスピーカー/ヘッドフォン',
      ],
    },
    steps: [
      {
        title: 'ステップ 1：Sokuji をダウンロード',
        content: `<a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">公式 GitHub リリースページ</a>にアクセスして、Windows 用の Sokuji の最新バージョンをダウンロードします。`,
        subsections: [
          {
            title: '適切なインストーラーを選択',
            content: `<ul>
              <li><strong>.exe インストーラー</strong> - Windows 用の標準インストーラー</li>
              <li><strong>ポータブル版</strong> - インストール不要（利用可能な場合）</li>
            </ul>`,
          },
        ],
      },
      {
        title: 'ステップ 2：インストーラーを実行',
        content: `ダウンロードが完了したら、インストーラーファイルを見つけて実行し、インストールを開始します。`,
        subsections: [
          {
            title: 'Windows Defender SmartScreen',
            content: `<p>インストーラーを実行すると、Windows Defender SmartScreen がアプリの起動を阻止する場合があります：</p>
            <img src="/tutorials/windows-install/1.png" alt="Windows Defender SmartScreen 警告" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>SmartScreen 警告で<strong>「詳細情報」</strong>をクリック</li>
              <li>ウィンドウが展開して詳細が表示されます：</li>
            </ol>
            <img src="/tutorials/windows-install/2.png" alt="Windows Defender SmartScreen 展開ビュー" class="install-page__screenshot" data-lightbox="true" />
            <ol start="3">
              <li><strong>「実行」</strong>をクリックしてインストールを続行</li>
            </ol>`,
          },
        ],
        warning:
          'Windowsは署名されていないアプリケーションに対してセキュリティ警告を表示する場合があります。Sokujiは安全にインストールできます。これらの警告は、アプリがまだ商用証明書で署名されていないために表示されます。',
      },
      {
        title: 'ステップ 3：VB-CABLE 仮想オーディオデバイスをインストール',
        content: `Sokuji は、他のアプリケーションにオーディオをルーティングするために VB-CABLE 仮想オーディオデバイスが必要です。インストーラーは自動的にインストールするように促します。`,
        subsections: [
          {
            title: 'VB-CABLE インストール',
            content: `<p>SmartScreen を回避した後、VB-CABLE インストールプロンプトが表示されます：</p>
            <img src="/tutorials/windows-install/3.png" alt="VB-CABLE インストールプロンプト" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li><strong>「Install Now」</strong>をクリックして VB-CABLE を自動的にダウンロードしてインストール</li>
              <li>または、「Download Manually」をクリックして <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">vb-audio.com/Cable</a> から手動で取得</li>
              <li>ユーザーアカウント制御のプロンプトが表示されたら、<strong>「はい」</strong>をクリックしてインストールを許可：</li>
            </ol>
            <img src="/tutorials/windows-install/3.5.jpg" alt="VB-CABLE のユーザーアカウント制御プロンプト" class="install-page__screenshot" data-lightbox="true" />
            <ol start="4">
              <li>VB-CABLE インストーラーが開きます。<strong>「Install Driver」</strong>をクリック：</li>
            </ol>
            <img src="/tutorials/windows-install/4.png" alt="VB-CABLE インストーラーウィンドウ" class="install-page__screenshot" data-lightbox="true" />
            <ol start="5">
              <li>インストールが完了するまで待ちます。成功メッセージが表示されます：</li>
            </ol>
            <img src="/tutorials/windows-install/5.png" alt="VB-CABLE インストール完了" class="install-page__screenshot" data-lightbox="true" />
            <ol start="6">
              <li>インストール完了ダイアログで<strong>「OK」</strong>をクリック</li>
              <li>最終確認が表示されます：</li>
            </ol>
            <img src="/tutorials/windows-install/6.png" alt="VB-CABLE インストール成功確認" class="install-page__screenshot" data-lightbox="true" />
            <ol start="8">
              <li><strong>「OK」</strong>をクリックして VB-CABLE インストールを完了</li>
            </ol>`,
          },
        ],
        info: 'VB-CABLE は、Sokuji が翻訳された音声を Zoom、Teams、Google Meet などのビデオ会議アプリケーションに渡すことを可能にする仮想オーディオデバイスを作成します。',
      },
      {
        title: 'ステップ 4：初回起動設定',
        content: `VB-CABLE インストール後、Sokuji が自動的に起動し、オーディオ構成ページが表示されます：`,
        subsections: [
          {
            title: 'オーディオデバイスの確認',
            content: `<img src="/tutorials/windows-install/7.png" alt="VB-CABLE デバイスを表示する Sokuji オーディオ構成" class="install-page__screenshot" data-lightbox="true" />
            <p>オーディオ設定パネルでは、次のものが表示されるはずです：</p>
            <ul>
              <li><strong>CABLE Output (VB-Audio Virtual Cable)</strong> - 利用可能な入力デバイスにリストされます</li>
              <li><strong>CABLE Input (VB-Audio Virtual Cable)</strong> - 利用可能なモニターデバイスにリストされます</li>
            </ul>
            <p>これらの仮想デバイスは、VB-CABLE が正常にインストールされたことを確認します。</p>`,
          },
          {
            title: '設定を完了',
            content: `<ol>
              <li>お好みの AI プロバイダー（OpenAI、Google Gemini など）を設定</li>
              <li>選択したプロバイダーの API キーを入力</li>
              <li>ソース言語とターゲット言語を選択</li>
              <li>オーディオ入力/出力デバイスをテスト</li>
              <li>物理マイクをオーディオ入力デバイスとして選択</li>
              <li>スピーカー/ヘッドフォンを仮想スピーカーモニターデバイスとして選択</li>
            </ol>`,
          },
        ],
        success:
          'Sokuji の準備が整いました！セッション開始ボタンをクリックしてリアルタイム翻訳を開始できます。',
      },
    ],
    troubleshooting: {
      title: 'トラブルシューティング',
      issues: [
        {
          title: 'Windows Defenderがインストールをブロックする',
          content: `Windows Defender SmartScreenがインストールをブロックする場合：
          <ol>
            <li>SmartScreen警告で「詳細情報」をクリック</li>
            <li>「実行」をクリックしてインストールを続行</li>
          </ol>
          これは署名されていないアプリケーションの一般的な問題であり、セキュリティ上の問題を示すものではありません。`,
        },
        {
          title: 'マイクが検出されない',
          content: `マイクが検出されない場合：
          <ol>
            <li>Windows設定 → プライバシー → マイクを開く</li>
            <li>「アプリにマイクへのアクセスを許可する」が有効になっていることを確認</li>
            <li>アプリリストでSokujiがリストされ、有効になっていることを確認</li>
            <li>マイクが正しく接続され、デフォルトデバイスとして設定されていることを確認</li>
          </ol>`,
        },
        {
          title: 'オーディオ出力がない',
          content: `オーディオが聞こえない場合：
          <ol>
            <li>システムトレイのスピーカーアイコンを右クリック</li>
            <li>「サウンド設定を開く」を選択</li>
            <li>出力デバイスが正しく選択されていることを確認</li>
            <li>音量レベルがミュートされていないことを確認</li>
          </ol>`,
        },
        {
          title: 'アプリケーションが起動しない',
          content: `Sokujiが起動しない場合：
          <ul>
            <li>管理者として実行してみる（右クリック → 管理者として実行）</li>
            <li>ウイルス対策ソフトウェアがアプリケーションをブロックしていないか確認</li>
            <li>アプリケーションを再インストール</li>
            <li>最新のWindows更新プログラムがインストールされていることを確認</li>
          </ul>`,
        },
        {
          title: 'VB-CABLE デバイスが検出されない',
          content: `Sokuji で CABLE Output/Input デバイスが表示されない場合：
          <ol>
            <li><strong>コンピューターを再起動</strong> - これは通常、デバイス認識の問題を解決します</li>
            <li><strong>Windows サウンド設定を確認</strong>：
              <ul>
                <li>システムトレイのスピーカーアイコンを右クリック</li>
                <li>「サウンド設定」を選択</li>
                <li>再生デバイスで「CABLE Input」を探す</li>
                <li>録音デバイスで「CABLE Output」を探す</li>
              </ul>
            </li>
            <li><strong>VB-CABLE を手動で再インストール</strong>：
              <ul>
                <li><a href="https://vb-audio.com/Cable/" target="_blank">vb-audio.com/Cable</a> からダウンロード</li>
                <li>ZIP ファイルを解凍</li>
                <li>管理者として VBCABLE_Setup_x64.exe を実行</li>
                <li>インストール後にコンピューターを再起動</li>
              </ul>
            </li>
            <li><strong>デバイスマネージャーを確認</strong>：
              <ul>
                <li>デバイスマネージャーを開く（Win+X → デバイスマネージャー）</li>
                <li>「サウンド、ビデオ、およびゲームコントローラー」の下を確認</li>
                <li>「VB-Audio Virtual Cable」がエラーなしでリストされていることを確認</li>
              </ul>
            </li>
          </ol>`,
        },
      ],
    },
  },
  ko: {
    pageTitle: 'Windows 설치 가이드',
    overview:
      '이 가이드는 Windows 시스템에서 Sokuji를 설치하는 과정을 안내합니다. Sokuji는 Windows 10 및 Windows 11에서 손쉽게 설치할 수 있는 .exe 설치 프로그램으로 제공됩니다.',
    downloadButton: 'Windows용 다운로드',
    requirements: {
      title: '시스템 요구 사항',
      items: [
        'Windows 10 (버전 1903 이상) 또는 Windows 11',
        '64비트 프로세서',
        '최소 4GB RAM (8GB 권장)',
        '200MB 이상의 사용 가능한 디스크 공간',
        'AI 번역 서비스를 위한 인터넷 연결',
        '마이크와 스피커/헤드폰',
      ],
    },
    steps: [
      {
        title: '단계 1: Sokuji 다운로드',
        content: `최신 Windows용 Sokuji를 다운로드하려면 <a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">공식 GitHub 릴리스 페이지</a>를 방문하세요.`,
        subsections: [
          {
            title: '올바른 설치 프로그램 선택',
            content: `<ul>
              <li><strong>.exe 설치 프로그램</strong> - Windows용 표준 설치 프로그램</li>
              <li><strong>포터블 버전</strong> - 설치가 필요 없음 (제공되는 경우)</li>
            </ul>`,
          },
        ],
      },
      {
        title: '단계 2: 설치 프로그램 실행',
        content: `다운로드가 완료되면 설치 파일을 찾아 실행하여 설치를 시작합니다.`,
        subsections: [
          {
            title: 'Windows Defender SmartScreen',
            content: `<p>설치 프로그램을 실행할 때 Windows Defender SmartScreen이 앱 시작을 차단할 수 있습니다:</p>
            <img src="/tutorials/windows-install/1.png" alt="Windows Defender SmartScreen 경고" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li>SmartScreen 경고에서 <strong>"추가 정보"</strong>를 클릭합니다</li>
              <li>창이 확장되어 더 많은 세부 정보가 표시됩니다:</li>
            </ol>
            <img src="/tutorials/windows-install/2.png" alt="Windows Defender SmartScreen 확장 보기" class="install-page__screenshot" data-lightbox="true" />
            <ol start="3">
              <li><strong>"실행"</strong>을 클릭하여 설치를 계속합니다</li>
            </ol>`,
          },
        ],
        warning:
          'Windows는 서명되지 않은 애플리케이션에 대해 보안 경고를 표시할 수 있습니다. Sokuji는 안전하게 설치할 수 있습니다. 이 경고는 앱이 아직 상용 인증서로 서명되지 않았기 때문에 나타납니다.',
      },
      {
        title: '단계 3: VB-CABLE 가상 오디오 장치 설치',
        content: `Sokuji는 다른 애플리케이션으로 오디오를 라우팅하기 위해 VB-CABLE 가상 오디오 장치를 필요로 합니다. 설치 프로그램이 자동 설치를 안내합니다.`,
        subsections: [
          {
            title: 'VB-CABLE 설치',
            content: `<p>SmartScreen을 우회한 후 VB-CABLE 설치 프롬프트가 표시됩니다:</p>
            <img src="/tutorials/windows-install/3.png" alt="VB-CABLE 설치 프롬프트" class="install-page__screenshot" data-lightbox="true" />
            <ol>
              <li><strong>"Install Now"</strong>를 클릭하여 VB-CABLE을 자동으로 다운로드 및 설치합니다</li>
              <li>또는, <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer">vb-audio.com/Cable</a>에서 <em>Download Manually</em>로 직접 다운로드할 수 있습니다</li>
              <li>사용자 계정 컨트롤(UAC) 프롬프트가 나타나면 설치를 허용하기 위해 <strong>"예"</strong>를 클릭합니다:</li>
            </ol>
            <img src="/tutorials/windows-install/3.5.jpg" alt="VB-CABLE에 대한 사용자 계정 컨트롤 프롬프트" class="install-page__screenshot" data-lightbox="true" />
            <ol start="4">
              <li>VB-CABLE 설치 관리자가 열립니다. <strong>"Install Driver"</strong>를 클릭합니다:</li>
            </ol>
            <img src="/tutorials/windows-install/4.png" alt="VB-CABLE 설치 관리자 창" class="install-page__screenshot" data-lightbox="true" />
            <ol start="5">
              <li>설치가 완료될 때까지 기다립니다. 성공 메시지가 표시됩니다:</li>
            </ol>
            <img src="/tutorials/windows-install/5.png" alt="VB-CABLE 설치 완료" class="install-page__screenshot" data-lightbox="true" />
            <ol start="6">
              <li>설치 완료 대화상자에서 <strong>"OK"</strong>를 클릭합니다</li>
              <li>최종 확인이 표시됩니다:</li>
            </ol>
            <img src="/tutorials/windows-install/6.png" alt="VB-CABLE 설치 성공 확인" class="install-page__screenshot" data-lightbox="true" />
            <ol start="8">
              <li><strong>"OK"</strong>를 클릭하여 VB-CABLE 설치를 마무리합니다</li>
            </ol>`,
          },
        ],
        info: 'VB-CABLE은 Sokuji가 번역된 오디오를 Zoom, Teams, Google Meet 등의 화상 회의 애플리케이션으로 전달할 수 있도록 하는 가상 오디오 장치를 생성합니다.',
      },
      {
        title: '단계 4: 첫 실행 설정',
        content: `VB-CABLE 설치 후 Sokuji가 자동으로 실행되며 오디오 구성 페이지가 표시됩니다:`,
        subsections: [
          {
            title: '오디오 장치 확인',
            content: `<img src="/tutorials/windows-install/7.png" alt="VB-CABLE 장치가 표시된 Sokuji 오디오 구성" class="install-page__screenshot" data-lightbox="true" />
            <p>오디오 설정 패널에서 다음을 확인할 수 있어야 합니다:</p>
            <ul>
              <li><strong>CABLE Output (VB-Audio Virtual Cable)</strong> - 사용 가능한 입력 장치에 표시</li>
              <li><strong>CABLE Input (VB-Audio Virtual Cable)</strong> - 사용 가능한 모니터 장치에 표시</li>
            </ul>
            <p>이 가상 장치들은 VB-CABLE이 성공적으로 설치되었음을 의미합니다.</p>`,
          },
          {
            title: '설정 완료',
            content: `<ol>
              <li>선호하는 AI 공급자(OpenAI, Google Gemini 등) 구성</li>
              <li>선택한 공급자의 API 키 입력</li>
              <li>소스 언어와 대상 언어 선택</li>
              <li>오디오 입력/출력 장치 테스트</li>
              <li>물리적 마이크를 오디오 입력 장치로 선택</li>
              <li>스피커/헤드폰을 가상 스피커 모니터 장치로 선택</li>
            </ol>`,
          },
        ],
        success:
          '이제 Sokuji를 사용할 준비가 되었습니다! 세션 시작 버튼을 클릭하여 실시간 번역을 시작할 수 있습니다.',
      },
    ],
    troubleshooting: {
      title: '문제 해결',
      issues: [
        {
          title: 'Windows Defender가 설치를 차단함',
          content: `Windows Defender SmartScreen이 설치를 차단하는 경우:
          <ol>
            <li>SmartScreen 경고에서 "추가 정보"를 클릭</li>
            <li>"실행"을 클릭하여 설치 계속</li>
          </ol>
          이는 서명되지 않은 애플리케이션의 일반적인 현상이며 보안 문제가 있음을 의미하지는 않습니다.`,
        },
        {
          title: '마이크가 감지되지 않음',
          content: `마이크가 감지되지 않는 경우:
          <ol>
            <li>Windows 설정 → 개인 정보 → 마이크 열기</li>
            <li>"앱이 마이크에 액세스하도록 허용"이 활성화되어 있는지 확인</li>
            <li>앱 목록에서 Sokuji가 표시되고 활성화되어 있는지 확인</li>
            <li>마이크가 올바르게 연결되고 기본 장치로 설정되어 있는지 확인</li>
          </ol>`,
        },
        {
          title: '오디오 출력 없음',
          content: `오디오가 들리지 않는 경우:
          <ol>
            <li>시스템 트레이의 스피커 아이콘을 마우스 오른쪽 버튼으로 클릭</li>
            <li>"사운드 설정 열기" 선택</li>
            <li>출력 장치가 올바르게 선택되었는지 확인</li>
            <li>볼륨 수준이 음소거되지 않았는지 확인</li>
          </ol>`,
        },
        {
          title: '애플리케이션이 시작되지 않음',
          content: `Sokuji가 시작되지 않는 경우:
          <ul>
            <li>관리자 권한으로 실행 시도 (마우스 오른쪽 클릭 → 관리자 권한으로 실행)</li>
            <li>바이러스 백신 소프트웨어가 애플리케이션을 차단하는지 확인</li>
            <li>애플리케이션 재설치</li>
            <li>최신 Windows 업데이트가 설치되어 있는지 확인</li>
          </ul>`,
        },
        {
          title: 'VB-CABLE 장치가 감지되지 않음',
          content: `Sokuji에서 CABLE Output/Input 장치가 보이지 않는 경우:
          <ol>
            <li><strong>컴퓨터 재시작</strong> - 장치 인식 문제를 해결하는 데 도움이 됩니다</li>
            <li><strong>Windows 사운드 설정 확인</strong>:
              <ul>
                <li>시스템 트레이의 스피커 아이콘을 마우스 오른쪽 버튼으로 클릭</li>
                <li>"사운드 설정" 선택</li>
                <li>재생 장치에서 "CABLE Input" 확인</li>
                <li>녹음 장치에서 "CABLE Output" 확인</li>
              </ul>
            </li>
            <li><strong>VB-CABLE 수동 재설치</strong>:
              <ul>
                <li><a href="https://vb-audio.com/Cable/" target="_blank">vb-audio.com/Cable</a>에서 다운로드</li>
                <li>ZIP 파일 압축 해제</li>
                <li>관리자 권한으로 VBCABLE_Setup_x64.exe 실행</li>
                <li>설치 후 컴퓨터 재시작</li>
              </ul>
            </li>
            <li><strong>장치 관리자 확인</strong>:
              <ul>
                <li>장치 관리자 열기 (Win+X → 장치 관리자)</li>
                <li>"사운드, 비디오 및 게임 컨트롤러" 아래에서 확인</li>
                <li>"VB-Audio Virtual Cable"이 오류 없이 표시되는지 확인</li>
              </ul>
            </li>
          </ol>`,
        },
      ],
    },
  },
};

export function WindowsInstall() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const openLightbox = (src: string, alt: string) => {
    setLightboxImage({ src, alt });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  // Handle click on images with data-lightbox attribute
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && target.getAttribute('data-lightbox') === 'true') {
      const img = target as HTMLImageElement;
      openLightbox(img.src, img.alt);
    }
  };

  return (
    <div className="docs-content install-page" onClick={handleContentClick}>
      <h1>{data.pageTitle}</h1>

      <p className="install-page__overview">{data.overview}</p>

      <a
        href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="install-page__download-btn"
      >
        <Download size={20} />
        {data.downloadButton}
        <ExternalLink size={16} />
      </a>

      {/* System Requirements */}
      <div className="install-page__requirements">
        <h3>{data.requirements.title}</h3>
        <ul>
          {data.requirements.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Installation Steps */}
      {data.steps.map((step, stepIndex) => (
        <div key={stepIndex}>
          <h2>{step.title}</h2>
          <div className="install-page__step">
            <p dangerouslySetInnerHTML={{ __html: step.content }} />

            {step.subsections?.map((subsection, subIndex) => (
              <div key={subIndex}>
                <h4>{subsection.title}</h4>
                <div dangerouslySetInnerHTML={{ __html: subsection.content }} />
              </div>
            ))}

            {step.warning && <div className="install-page__warning">{step.warning}</div>}

            {step.info && <div className="install-page__info">{step.info}</div>}

            {step.success && <div className="install-page__success">{step.success}</div>}
          </div>
        </div>
      ))}

      {/* Troubleshooting */}
      <div className="install-page__troubleshooting">
        <h2>{data.troubleshooting.title}</h2>

        {data.troubleshooting.issues.map((issue, index) => (
          <div key={index} className="install-page__issue">
            <h3>{issue.title}</h3>
            <div dangerouslySetInnerHTML={{ __html: issue.content }} />
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          isOpen={!!lightboxImage}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}

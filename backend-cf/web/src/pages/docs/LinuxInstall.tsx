/**
 * Linux Installation Guide Page
 * Completely synced with docs/tutorials/linux-install.html
 */

import { useState, useCallback } from 'react';
import { ArrowLeft, ExternalLink, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { Lightbox } from '@/components/docs/Lightbox';
import './docs.scss';

// Types for the Linux install data structure
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

interface LinuxInstallData {
  pageTitle: string;
  langLabel: string;
  backLink: string;
  tocTitle: string;
  mobileJumpTo: string;
  overview: string;
  requirements: {
    title: string;
    items: string[];
  };
  steps: Step[];
  troubleshooting: {
    title: string;
    issues: TroubleshootingIssue[];
  };
  footer: string;
}

// Translations object - exactly matching linux-install.html
const translations: Record<string, LinuxInstallData> = {
  en: {
    pageTitle: "Linux Installation Guide",
    langLabel: "Language:",
    backLink: "← Back to Documentation",
    tocTitle: "Table of Contents",
    mobileJumpTo: "Jump to section...",
    overview: "This guide will walk you through installing Sokuji on Linux systems. Sokuji is available as a .deb package for Debian/Ubuntu-based distributions and as an AppImage for universal compatibility.",
    requirements: {
      title: "System Requirements",
      items: [
        "Ubuntu 20.04 or later, Debian 10 or later, or equivalent distribution",
        "64-bit processor",
        "4GB RAM minimum (8GB recommended)",
        "100MB available disk space",
        "PulseAudio or PipeWire for audio support",
        "Internet connection for AI services"
      ]
    },
    steps: [
      {
        title: "Step 1: Download Sokuji",
        content: `Visit the <a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">official GitHub releases page</a> to download the latest version of Sokuji for Linux.`,
        subsections: [
          {
            title: "Available Packages",
            content: `<ul>
              <li><strong>.deb package</strong> - For Debian/Ubuntu based distributions</li>
              <li><strong>.AppImage</strong> - Universal package for all Linux distributions</li>
              <li><strong>.rpm package</strong> - For Fedora/RHEL based distributions (if available)</li>
            </ul>`
          }
        ]
      },
      {
        title: "Step 2: Installing .deb Package (Ubuntu/Debian)",
        content: `If you're using Ubuntu, Debian, or their derivatives, the .deb package is recommended.`,
        subsections: [
          {
            title: "Method 1: Using GUI",
            content: `<ol>
              <li>Open your file manager and navigate to the Downloads folder</li>
              <li>Double-click the <code>sokuji_*.deb</code> file</li>
              <li>Click "Install" in the Software Center that opens</li>
              <li>Enter your password when prompted</li>
            </ol>`
          },
          {
            title: "Method 2: Using Terminal",
            content: `Open Terminal and run the following commands:
            <pre><code>cd ~/Downloads
sudo dpkg -i sokuji_*.deb</code></pre>
            If you encounter dependency issues, fix them with:
            <pre><code>sudo apt-get install -f</code></pre>`
          }
        ]
      },
      {
        title: "Step 3: Installing AppImage (Universal)",
        content: `AppImage works on all Linux distributions and doesn't require installation.`,
        subsections: [
          {
            title: "Setup AppImage",
            content: `<ol>
              <li>Download the AppImage file from the releases page</li>
              <li>Make it executable:
                <pre><code>chmod +x sokuji-*.AppImage</code></pre>
              </li>
              <li>Run the application:
                <pre><code>./sokuji-*.AppImage</code></pre>
              </li>
            </ol>`
          },
          {
            title: "Optional: System Integration",
            content: `To integrate the AppImage with your system:
            <pre><code>mkdir -p ~/.local/bin
cp sokuji-*.AppImage ~/.local/bin/sokuji
chmod +x ~/.local/bin/sokuji</code></pre>
            Now you can run Sokuji from anywhere by typing <code>sokuji</code> in the terminal.`
          }
        ]
      },
      {
        title: "Step 4: First Run Configuration",
        content: `When you launch Sokuji for the first time, you'll need to configure it:`,
        subsections: [
          {
            title: "Initial Setup",
            content: `<ol>
              <li>Launch Sokuji from your application menu or terminal</li>
              <li>Select your preferred interface language</li>
              <li>Configure your AI provider (OpenAI, Google Gemini, etc.)</li>
              <li>Enter your API key for the selected provider</li>
              <li>Select your microphone and speaker devices</li>
              <li>Test the audio to ensure everything works</li>
            </ol>`
          }
        ],
        success: "Sokuji is now ready to use! You can start real-time translation by clicking the start session button."
      }
    ],
    troubleshooting: {
      title: "Troubleshooting",
      issues: [
        {
          title: "Audio Issues",
          content: `If you experience audio problems:
          <ul>
            <li>Ensure PulseAudio or PipeWire is running: <code>systemctl --user status pipewire</code></li>
            <li>Check audio permissions: <code>groups $USER</code> should include 'audio'</li>
            <li>Restart audio service: <code>systemctl --user restart pipewire</code></li>
          </ul>`
        },
        {
          title: "Permission Denied",
          content: `If you get "Permission denied" errors:
          <pre><code>sudo usermod -a -G audio $USER</code></pre>
          Then log out and log back in for the changes to take effect.`
        },
        {
          title: "Missing Dependencies",
          content: `Install required libraries:
          <pre><code>sudo apt-get update
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 \\
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1</code></pre>`
        },
        {
          title: "AppImage Won't Run",
          content: `If AppImage fails to run, install FUSE:
          <pre><code>sudo apt-get install fuse libfuse2</code></pre>
          For newer systems (Ubuntu 22.04+), you might need:
          <pre><code>sudo apt-get install libfuse2t64</code></pre>`
        }
      ]
    },
    footer: "© 2025 Kizuna AI Lab. All rights reserved."
  },
  zh: {
    pageTitle: "Linux 安装指南",
    langLabel: "语言：",
    backLink: "← 返回文档",
    tocTitle: "目录",
    mobileJumpTo: "跳转到章节...",
    overview: "本指南将指导您在 Linux 系统上安装 Sokuji。Sokuji 提供 .deb 包用于 Debian/Ubuntu 发行版，以及 AppImage 用于通用兼容性。",
    requirements: {
      title: "系统要求",
      items: [
        "Ubuntu 20.04 或更高版本，Debian 10 或更高版本，或同等发行版",
        "64 位处理器",
        "最少 4GB RAM（推荐 8GB）",
        "100MB 可用磁盘空间",
        "用于音频支持的 PulseAudio 或 PipeWire",
        "用于 AI 服务的互联网连接"
      ]
    },
    steps: [
      {
        title: "步骤 1：下载 Sokuji",
        content: `访问 <a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">官方 GitHub 发布页面</a> 下载最新版本的 Linux 版 Sokuji。`,
        subsections: [
          {
            title: "可用的安装包",
            content: `<ul>
              <li><strong>.deb 包</strong> - 用于基于 Debian/Ubuntu 的发行版</li>
              <li><strong>.AppImage</strong> - 适用于所有 Linux 发行版的通用包</li>
              <li><strong>.rpm 包</strong> - 用于基于 Fedora/RHEL 的发行版（如果可用）</li>
            </ul>`
          }
        ]
      },
      {
        title: "步骤 2：安装 .deb 包（Ubuntu/Debian）",
        content: `如果您使用 Ubuntu、Debian 或其衍生版，推荐使用 .deb 包。`,
        subsections: [
          {
            title: "方法 1：使用 GUI",
            content: `<ol>
              <li>打开文件管理器并导航到下载文件夹</li>
              <li>双击 <code>sokuji_*.deb</code> 文件</li>
              <li>在打开的软件中心中点击"安装"</li>
              <li>在提示时输入您的密码</li>
            </ol>`
          },
          {
            title: "方法 2：使用终端",
            content: `打开终端并运行以下命令：
            <pre><code>cd ~/Downloads
sudo dpkg -i sokuji_*.deb</code></pre>
            如果遇到依赖问题，使用以下命令修复：
            <pre><code>sudo apt-get install -f</code></pre>`
          }
        ]
      },
      {
        title: "步骤 3：安装 AppImage（通用）",
        content: `AppImage 适用于所有 Linux 发行版，无需安装。`,
        subsections: [
          {
            title: "设置 AppImage",
            content: `<ol>
              <li>从发布页面下载 AppImage 文件</li>
              <li>使其可执行：
                <pre><code>chmod +x sokuji-*.AppImage</code></pre>
              </li>
              <li>运行应用程序：
                <pre><code>./sokuji-*.AppImage</code></pre>
              </li>
            </ol>`
          },
          {
            title: "可选：系统集成",
            content: `要将 AppImage 与系统集成：
            <pre><code>mkdir -p ~/.local/bin
cp sokuji-*.AppImage ~/.local/bin/sokuji
chmod +x ~/.local/bin/sokuji</code></pre>
            现在您可以在终端的任何位置输入 <code>sokuji</code> 来运行 Sokuji。`
          }
        ]
      },
      {
        title: "步骤 4：首次运行配置",
        content: `首次启动 Sokuji 时，您需要进行配置：`,
        subsections: [
          {
            title: "初始设置",
            content: `<ol>
              <li>从应用程序菜单或终端启动 Sokuji</li>
              <li>选择您喜欢的界面语言</li>
              <li>配置您的 AI 提供商（OpenAI、Google Gemini 等）</li>
              <li>输入所选提供商的 API 密钥</li>
              <li>选择您的麦克风和扬声器设备</li>
              <li>测试音频以确保一切正常</li>
            </ol>`
          }
        ],
        success: "Sokuji 现在已准备就绪！您可以通过点击开始会话按钮开始实时翻译。"
      }
    ],
    troubleshooting: {
      title: "故障排除",
      issues: [
        {
          title: "音频问题",
          content: `如果遇到音频问题：
          <ul>
            <li>确保 PulseAudio 或 PipeWire 正在运行：<code>systemctl --user status pipewire</code></li>
            <li>检查音频权限：<code>groups $USER</code> 应包含 'audio'</li>
            <li>重启音频服务：<code>systemctl --user restart pipewire</code></li>
          </ul>`
        },
        {
          title: "权限拒绝",
          content: `如果收到"Permission denied"错误：
          <pre><code>sudo usermod -a -G audio $USER</code></pre>
          然后注销并重新登录以使更改生效。`
        },
        {
          title: "缺少依赖项",
          content: `安装所需的库：
          <pre><code>sudo apt-get update
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 \\
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1</code></pre>`
        },
        {
          title: "AppImage 无法运行",
          content: `如果 AppImage 无法运行，请安装 FUSE：
          <pre><code>sudo apt-get install fuse libfuse2</code></pre>
          对于较新的系统（Ubuntu 22.04+），您可能需要：
          <pre><code>sudo apt-get install libfuse2t64</code></pre>`
        }
      ]
    },
    footer: "© 2025 Kizuna AI Lab. 保留所有权利。"
  },
  ja: {
    pageTitle: "Linux インストールガイド",
    langLabel: "言語：",
    backLink: "← ドキュメントに戻る",
    tocTitle: "目次",
    mobileJumpTo: "セクションにジャンプ...",
    overview: "このガイドでは、Linux システムに Sokuji をインストールする方法を説明します。Sokuji は Debian/Ubuntu ベースのディストリビューション用の .deb パッケージと、汎用互換性のための AppImage として利用可能です。",
    requirements: {
      title: "システム要件",
      items: [
        "Ubuntu 20.04 以降、Debian 10 以降、または同等のディストリビューション",
        "64 ビットプロセッサー",
        "最小 4GB RAM（推奨 8GB）",
        "100MB の空きディスク容量",
        "音声サポート用の PulseAudio または PipeWire",
        "AI サービス用のインターネット接続"
      ]
    },
    steps: [
      {
        title: "ステップ 1：Sokuji をダウンロード",
        content: `<a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">公式 GitHub リリースページ</a>にアクセスして、Linux 用の Sokuji の最新バージョンをダウンロードします。`,
        subsections: [
          {
            title: "利用可能なパッケージ",
            content: `<ul>
              <li><strong>.deb パッケージ</strong> - Debian/Ubuntu ベースのディストリビューション用</li>
              <li><strong>.AppImage</strong> - すべての Linux ディストリビューション用の汎用パッケージ</li>
              <li><strong>.rpm パッケージ</strong> - Fedora/RHEL ベースのディストリビューション用（利用可能な場合）</li>
            </ul>`
          }
        ]
      },
      {
        title: "ステップ 2：.deb パッケージのインストール（Ubuntu/Debian）",
        content: `Ubuntu、Debian、またはその派生版を使用している場合は、.deb パッケージをお勧めします。`,
        subsections: [
          {
            title: "方法 1：GUI を使用",
            content: `<ol>
              <li>ファイルマネージャーを開き、ダウンロードフォルダーに移動</li>
              <li><code>sokuji_*.deb</code> ファイルをダブルクリック</li>
              <li>開いたソフトウェアセンターで「インストール」をクリック</li>
              <li>要求されたらパスワードを入力</li>
            </ol>`
          },
          {
            title: "方法 2：ターミナルを使用",
            content: `ターミナルを開いて以下のコマンドを実行：
            <pre><code>cd ~/Downloads
sudo dpkg -i sokuji_*.deb</code></pre>
            依存関係の問題が発生した場合は、以下で修正：
            <pre><code>sudo apt-get install -f</code></pre>`
          }
        ]
      },
      {
        title: "ステップ 3：AppImage のインストール（汎用）",
        content: `AppImage はすべての Linux ディストリビューションで動作し、インストールは不要です。`,
        subsections: [
          {
            title: "AppImage のセットアップ",
            content: `<ol>
              <li>リリースページから AppImage ファイルをダウンロード</li>
              <li>実行可能にする：
                <pre><code>chmod +x sokuji-*.AppImage</code></pre>
              </li>
              <li>アプリケーションを実行：
                <pre><code>./sokuji-*.AppImage</code></pre>
              </li>
            </ol>`
          },
          {
            title: "オプション：システム統合",
            content: `AppImage をシステムに統合するには：
            <pre><code>mkdir -p ~/.local/bin
cp sokuji-*.AppImage ~/.local/bin/sokuji
chmod +x ~/.local/bin/sokuji</code></pre>
            これで、ターミナルの任意の場所で <code>sokuji</code> と入力して Sokuji を実行できます。`
          }
        ]
      },
      {
        title: "ステップ 4：初回起動設定",
        content: `Sokuji を初めて起動するときは、設定が必要です：`,
        subsections: [
          {
            title: "初期設定",
            content: `<ol>
              <li>アプリケーションメニューまたはターミナルから Sokuji を起動</li>
              <li>希望のインターフェース言語を選択</li>
              <li>AI プロバイダー（OpenAI、Google Gemini など）を設定</li>
              <li>選択したプロバイダーの API キーを入力</li>
              <li>マイクとスピーカーデバイスを選択</li>
              <li>オーディオをテストして、すべてが正常に動作することを確認</li>
            </ol>`
          }
        ],
        success: "Sokuji の準備が整いました！セッション開始ボタンをクリックしてリアルタイム翻訳を開始できます。"
      }
    ],
    troubleshooting: {
      title: "トラブルシューティング",
      issues: [
        {
          title: "音声の問題",
          content: `音声に問題がある場合：
          <ul>
            <li>PulseAudio または PipeWire が実行中であることを確認：<code>systemctl --user status pipewire</code></li>
            <li>音声権限を確認：<code>groups $USER</code> に 'audio' が含まれているはず</li>
            <li>音声サービスを再起動：<code>systemctl --user restart pipewire</code></li>
          </ul>`
        },
        {
          title: "権限拒否",
          content: `「Permission denied」エラーが発生した場合：
          <pre><code>sudo usermod -a -G audio $USER</code></pre>
          その後、ログアウトして再度ログインして変更を適用します。`
        },
        {
          title: "依存関係の不足",
          content: `必要なライブラリをインストール：
          <pre><code>sudo apt-get update
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 \\
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1</code></pre>`
        },
        {
          title: "AppImage が実行できない",
          content: `AppImage が実行できない場合は、FUSE をインストール：
          <pre><code>sudo apt-get install fuse libfuse2</code></pre>
          新しいシステム（Ubuntu 22.04+）では、次が必要な場合があります：
          <pre><code>sudo apt-get install libfuse2t64</code></pre>`
        }
      ]
    },
    footer: "© 2025 Kizuna AI Lab. All rights reserved."
  },
  ko: {
    pageTitle: "Linux 설치 가이드",
    langLabel: "언어:",
    backLink: "← 문서로 돌아가기",
    tocTitle: "목차",
    mobileJumpTo: "섹션으로 이동...",
    overview: "이 가이드는 Linux 시스템에 Sokuji를 설치하는 방법을 안내합니다. Sokuji는 Debian/Ubuntu 기반 배포판용 .deb 패키지와 범용 호환성을 위한 AppImage로 제공됩니다.",
    requirements: {
      title: "시스템 요구 사항",
      items: [
        "Ubuntu 20.04 이상, Debian 10 이상 또는 동등한 배포판",
        "64비트 프로세서",
        "최소 4GB RAM (8GB 권장)",
        "100MB 사용 가능한 디스크 공간",
        "오디오 지원을 위한 PulseAudio 또는 PipeWire",
        "AI 서비스를 위한 인터넷 연결"
      ]
    },
    steps: [
      {
        title: "단계 1: Sokuji 다운로드",
        content: `<a href="https://github.com/kizuna-ai-lab/sokuji/releases/latest" target="_blank" rel="noopener noreferrer">공식 GitHub 릴리스 페이지</a>를 방문하여 Linux용 Sokuji 최신 버전을 다운로드하세요.`,
        subsections: [
          {
            title: "사용 가능한 패키지",
            content: `<ul>
              <li><strong>.deb 패키지</strong> - Debian/Ubuntu 기반 배포판용</li>
              <li><strong>.AppImage</strong> - 모든 Linux 배포판을 위한 범용 패키지</li>
              <li><strong>.rpm 패키지</strong> - Fedora/RHEL 기반 배포판용 (사용 가능한 경우)</li>
            </ul>`
          }
        ]
      },
      {
        title: "단계 2: .deb 패키지 설치 (Ubuntu/Debian)",
        content: `Ubuntu, Debian 또는 그 파생 버전을 사용하는 경우 .deb 패키지를 권장합니다.`,
        subsections: [
          {
            title: "방법 1: GUI 사용",
            content: `<ol>
              <li>파일 관리자를 열고 다운로드 폴더로 이동</li>
              <li><code>sokuji_*.deb</code> 파일을 더블 클릭</li>
              <li>열린 소프트웨어 센터에서 "설치"를 클릭</li>
              <li>요청 시 비밀번호 입력</li>
            </ol>`
          },
          {
            title: "방법 2: 터미널 사용",
            content: `터미널을 열고 다음 명령을 실행:
            <pre><code>cd ~/Downloads
sudo dpkg -i sokuji_*.deb</code></pre>
            종속성 문제가 발생하면 다음으로 수정:
            <pre><code>sudo apt-get install -f</code></pre>`
          }
        ]
      },
      {
        title: "단계 3: AppImage 설치 (범용)",
        content: `AppImage는 모든 Linux 배포판에서 작동하며 설치가 필요하지 않습니다.`,
        subsections: [
          {
            title: "AppImage 설정",
            content: `<ol>
              <li>릴리스 페이지에서 AppImage 파일 다운로드</li>
              <li>실행 가능하게 만들기:
                <pre><code>chmod +x sokuji-*.AppImage</code></pre>
              </li>
              <li>애플리케이션 실행:
                <pre><code>./sokuji-*.AppImage</code></pre>
              </li>
            </ol>`
          },
          {
            title: "선택사항: 시스템 통합",
            content: `AppImage를 시스템과 통합하려면:
            <pre><code>mkdir -p ~/.local/bin
cp sokuji-*.AppImage ~/.local/bin/sokuji
chmod +x ~/.local/bin/sokuji</code></pre>
            이제 터미널 어디에서나 <code>sokuji</code>를 입력하여 Sokuji를 실행할 수 있습니다.`
          }
        ]
      },
      {
        title: "단계 4: 첫 실행 구성",
        content: `Sokuji를 처음 실행할 때 구성이 필요합니다:`,
        subsections: [
          {
            title: "초기 설정",
            content: `<ol>
              <li>애플리케이션 메뉴 또는 터미널에서 Sokuji 실행</li>
              <li>선호하는 인터페이스 언어 선택</li>
              <li>AI 제공자 구성 (OpenAI, Google Gemini 등)</li>
              <li>선택한 제공자의 API 키 입력</li>
              <li>마이크 및 스피커 장치 선택</li>
              <li>오디오를 테스트하여 모든 것이 작동하는지 확인</li>
            </ol>`
          }
        ],
        success: "이제 Sokuji를 사용할 준비가 되었습니다! 마이크 버튼을 클릭하여 실시간 번역을 시작할 수 있습니다."
      }
    ],
    troubleshooting: {
      title: "문제 해결",
      issues: [
        {
          title: "오디오 문제",
          content: `오디오 문제가 발생하는 경우:
          <ul>
            <li>PulseAudio 또는 PipeWire가 실행 중인지 확인: <code>systemctl --user status pipewire</code></li>
            <li>오디오 권한 확인: <code>groups $USER</code>에 'audio'가 포함되어야 함</li>
            <li>오디오 서비스 재시작: <code>systemctl --user restart pipewire</code></li>
          </ul>`
        },
        {
          title: "권한 거부",
          content: `"Permission denied" 오류가 발생하면:
          <pre><code>sudo usermod -a -G audio $USER</code></pre>
          그런 다음 로그아웃하고 다시 로그인하여 변경 사항을 적용하세요.`
        },
        {
          title: "누락된 종속성",
          content: `필요한 라이브러리 설치:
          <pre><code>sudo apt-get update
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 \\
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1</code></pre>`
        },
        {
          title: "AppImage가 실행되지 않음",
          content: `AppImage가 실행되지 않으면 FUSE 설치:
          <pre><code>sudo apt-get install fuse libfuse2</code></pre>
          최신 시스템 (Ubuntu 22.04+)의 경우 다음이 필요할 수 있습니다:
          <pre><code>sudo apt-get install libfuse2t64</code></pre>`
        }
      ]
    },
    footer: "© 2025 Kizuna AI Lab. 모든 권리 보유."
  }
};

export function LinuxInstall() {
  const { locale } = useI18n();
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Get current language data
  const currentLang = locale.startsWith('zh') ? 'zh' :
                      locale.startsWith('ja') ? 'ja' :
                      locale.startsWith('ko') ? 'ko' : 'en';
  const t = translations[currentLang] || translations.en;

  // Handle clicks on content that may contain images
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const src = (target as HTMLImageElement).src;
      setLightboxImage(src);
    }
  }, []);

  return (
    <div className="docs-content install-page">
      {/* Back link */}
      <Link to="/docs" className="tutorial-page__back-link">
        <ArrowLeft size={16} />
        {t.backLink}
      </Link>

      <h1>{t.pageTitle}</h1>

      <p className="install-page__overview">{t.overview}</p>

      {/* Download button */}
      <a
        href="https://github.com/kizuna-ai-lab/sokuji/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="install-page__download-btn"
      >
        <Download size={20} />
        {currentLang === 'zh' ? '下载 Linux 版本' :
         currentLang === 'ja' ? 'Linux版をダウンロード' :
         currentLang === 'ko' ? 'Linux용 다운로드' :
         'Download for Linux'}
        <ExternalLink size={16} />
      </a>

      {/* System Requirements */}
      <div className="install-page__requirements">
        <h3>{t.requirements.title}</h3>
        <ul>
          {t.requirements.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Installation Steps */}
      <h2>{currentLang === 'zh' ? '安装步骤' :
           currentLang === 'ja' ? 'インストール手順' :
           currentLang === 'ko' ? '설치 단계' :
           'Installation Steps'}</h2>

      {t.steps.map((step, stepIndex) => (
        <div key={stepIndex} className="install-page__step" onClick={handleContentClick}>
          <h3>{step.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: step.content }} />

          {step.subsections?.map((sub, subIndex) => (
            <div key={subIndex}>
              <h4>{sub.title}</h4>
              <div dangerouslySetInnerHTML={{ __html: sub.content }} />
            </div>
          ))}

          {step.warning && (
            <div className="install-page__warning">{step.warning}</div>
          )}

          {step.info && (
            <div className="install-page__info">{step.info}</div>
          )}

          {step.success && (
            <div className="install-page__success">{step.success}</div>
          )}
        </div>
      ))}

      {/* Troubleshooting */}
      <div className="install-page__troubleshooting">
        <h2>{t.troubleshooting.title}</h2>

        {t.troubleshooting.issues.map((issue, index) => (
          <div key={index} className="install-page__issue">
            <h3>{issue.title}</h3>
            <div dangerouslySetInnerHTML={{ __html: issue.content }} />
          </div>
        ))}
      </div>

      {/* Lightbox for images */}
      <Lightbox
        src={lightboxImage || ''}
        alt="Screenshot"
        isOpen={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}

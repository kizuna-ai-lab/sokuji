import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.scss';

export function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <div className="container">
        <header>
          <h1>Welcome to Eburon</h1>
          <p>Please select an app to get started</p>
        </header>

        <div className="grid">
          {/* Translator */}
          <div className="card bg-translator" onClick={() => navigate('/translator')}>
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <path d="M 15 25 h 45 c 5 0 10 5 10 10 v 25 c 0 5 -5 10 -10 10 h -10 v 15 l -15 -15 h -20 c -5 0 -10 -5 -10 -10 v -25 c 0 -5 5 -10 10 -10 z" fill="#FFFFFF"/>
                <text x="37" y="55" fontFamily="sans-serif" fontSize="28" fontWeight="bold" fill="#285493" textAnchor="middle">A</text>
                <path d="M 45 40 h 35 c 5 0 10 5 10 10 v 20 c 0 5 -5 10 -10 10 h -5 l -10 10 v -10 h -20 c -5 0 -10 -5 -10 -10 v -20 c 0 -5 5 -10 10 -10 z" fill="#4B85D3"/>
                <text x="62" y="68" fontFamily="sans-serif" fontSize="18" fill="white" textAnchor="middle">文</text>
              </svg>
            </div>
            <span>Translator</span>
          </div>

          {/* Dual Translate */}
          <div className="card bg-dual">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <rect x="10" y="20" width="45" height="32" rx="8" fill="#FFFFFF"/>
                <polygon points="55,36 65,36 55,46" fill="#FFFFFF"/>
                <text x="32" y="43" fontFamily="sans-serif" fontSize="20" fontWeight="bold" fill="#1e6c4c" textAnchor="middle">A</text>
                <rect x="45" y="48" width="45" height="32" rx="8" fill="#42A96D"/>
                <polygon points="45,64 35,64 45,54" fill="#42A96D"/>
                <text x="67" y="70" fontFamily="sans-serif" fontSize="18" fill="white" textAnchor="middle">文</text>
              </svg>
            </div>
            <span>Dual Translate</span>
          </div>

          {/* Classroom */}
          <div className="card bg-classroom">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <rect x="15" y="15" width="70" height="50" rx="4" fill="#FFCF49"/>
                <rect x="20" y="20" width="60" height="40" rx="2" fill="#226E4A"/>
                <circle cx="50" cy="35" r="7" fill="#FFFFFF"/>
                <path d="M 35 55 c 0 -8 8 -12 15 -12 s 15 4 15 12 z" fill="#FFFFFF"/>
                <path d="M 25 75 l -5 15 h 5 l 3 -10 h 44 l 3 10 h 5 l -5 -15 z" fill="#FFCF49"/>
              </svg>
            </div>
            <span>Classroom</span>
          </div>

          {/* Dubber */}
          <div className="card bg-dubber">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <rect x="40" y="20" width="20" height="35" rx="10" fill="#F49593"/>
                <path d="M 25 45 a 25 25 0 0 0 50 0" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round"/>
                <line x1="50" y1="70" x2="50" y2="85" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round"/>
                <line x1="35" y1="85" x2="65" y2="85" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round"/>
                <path d="M 75 15 q 5 5 10 5 q -5 0 -5 5 q -5 -5 -10 -5 q 5 0 5 -5 z" fill="#FFFFFF"/>
                <path d="M 25 25 q 3 3 6 3 q -3 0 -3 3 q -3 -3 -6 -3 q 3 0 3 -3 z" fill="#FFFFFF"/>
              </svg>
            </div>
            <span>Dubber</span>
          </div>

          {/* Transcriber */}
          <div className="card bg-transcriber">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <path d="M 25 10 h 35 l 20 20 v 60 c 0 5 -5 10 -10 10 h -45 c -5 0 -10 -5 -10 -10 v -70 c 0 -5 5 -10 10 -10 z" fill="#E2E8F0"/>
                <polygon points="60,10 80,30 60,30" fill="#CBD5E1"/>
                <path d="M 10 60 L 25 60 L 35 40 L 45 80 L 55 30 L 65 70 L 75 50 L 90 50" fill="none" stroke="#2563EB" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span>Transcriber</span>
          </div>

          {/* Clone Voice */}
          <div className="card bg-clone">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <path d="M 30 30 v 20 a 20 20 0 0 0 40 0 v -20" fill="none" stroke="#6EC1C6" strokeWidth="6" strokeLinecap="round"/>
                <rect x="42" y="15" width="16" height="30" rx="8" fill="#FFFFFF"/>
                <path d="M 50 70 v 15" stroke="#6EC1C6" strokeWidth="6" strokeLinecap="round"/>
                <path d="M 35 85 h 30" stroke="#6EC1C6" strokeWidth="6" strokeLinecap="round"/>
                <path d="M 15 40 v 10 M 85 40 v 10" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round"/>
                <path d="M 22 35 v 20 M 78 35 v 20" stroke="#6EC1C6" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            </div>
            <span>Clone Voice</span>
          </div>

          {/* Echo TTS */}
          <div className="card bg-echo" onClick={() => navigate('/tts-showcase')}>
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <path d="M 5 50 C 15 50 20 10 30 10 C 40 10 45 90 55 90 C 65 90 70 25 80 25 C 88 25 90 50 95 50" fill="none" stroke="#FFDC80" strokeWidth="6" strokeLinecap="round"/>
                <path d="M 5 50 C 15 50 20 30 30 30 C 40 30 45 70 55 70 C 65 70 70 40 80 40 C 88 40 90 50 95 50" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" opacity="0.5"/>
              </svg>
            </div>
            <span>TTS Showcase</span>
          </div>

          {/* Chatbot */}
          <div className="card bg-chatbot">
            <div className="icon-wrapper">
              <img src="https://eburon.ai/icon-eburon.svg" alt="Chatbot Icon"/>
            </div>
            <span>Chatbot</span>
          </div>

          {/* Agents */}
          <div className="card bg-agents">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="25" r="10" fill="#FFFFFF"/>
                <path d="M 35 45 q 15 -10 30 0 v 15 q -15 10 -30 0 z" fill="#C175D1"/>
                <circle cx="25" cy="70" r="10" fill="#FFFFFF"/>
                <path d="M 10 90 q 15 -10 30 0 v 10 h -30 z" fill="#C175D1"/>
                <circle cx="75" cy="70" r="10" fill="#FFFFFF"/>
                <path d="M 60 90 q 15 -10 30 0 v 10 h -30 z" fill="#C175D1"/>
                <path d="M 40 40 L 30 60 M 60 40 L 70 60" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            </div>
            <span>Agents</span>
          </div>

          {/* CSR */}
          <div className="card bg-csr">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="40" r="18" fill="#FFFFFF"/>
                <path d="M 20 90 c 0 -20 10 -30 30 -30 s 30 10 30 30" fill="#FFFFFF"/>
                <path d="M 25 40 a 25 25 0 0 1 50 0" fill="none" stroke="#258ECC" strokeWidth="5" strokeLinecap="round"/>
                <rect x="20" y="35" width="8" height="15" rx="4" fill="#258ECC"/>
                <rect x="72" y="35" width="8" height="15" rx="4" fill="#258ECC"/>
                <path d="M 76 45 v 15 c 0 5 -5 8 -10 8 h -5" fill="none" stroke="#258ECC" strokeWidth="4" strokeLinecap="round"/>
                <circle cx="58" cy="68" r="4" fill="#258ECC"/>
              </svg>
            </div>
            <span>CSR</span>
          </div>

          {/* Codemax */}
          <div className="card bg-codemax">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <rect x="10" y="20" width="80" height="60" rx="6" fill="#1A2530"/>
                <path d="M 10 26 c 0 -3.3 2.7 -6 6 -6 h 68 c 3.3 0 6 2.7 6 6 v 14 h -80 v -14 z" fill="#405163"/>
                <circle cx="20" cy="30" r="3" fill="#EF4444"/>
                <circle cx="30" cy="30" r="3" fill="#FBBF24"/>
                <circle cx="40" cy="30" r="3" fill="#10B981"/>
                <polyline points="35,50 25,60 35,70" fill="none" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="65,50 75,60 65,70" fill="none" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="55" y1="45" x2="45" y2="75" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            </div>
            <span>Codemax</span>
          </div>

          {/* Tools */}
          <div className="card bg-tools">
            <div className="icon-wrapper">
              <svg viewBox="0 0 100 100">
                <path d="M 22 22 L 78 78" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round"/>
                <circle cx="20" cy="20" r="12" fill="#FFFFFF"/>
                <circle cx="80" cy="80" r="12" fill="#FFFFFF"/>
                <circle cx="20" cy="20" r="6" fill="#9e4b21"/>
                <path d="M 12 12 L 28 28" stroke="#9e4b21" strokeWidth="6"/>
                <path d="M 78 22 L 22 78" stroke="#FFCF49" strokeWidth="8" strokeLinecap="round"/>
                <rect x="68" y="14" width="16" height="24" rx="4" fill="#FFFFFF" transform="rotate(45 76 26)"/>
                <path d="M 28 72 L 15 85" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round"/>
              </svg>
            </div>
            <span>Tools</span>
          </div>
        </div>
      </div>
    </div>
  );
}

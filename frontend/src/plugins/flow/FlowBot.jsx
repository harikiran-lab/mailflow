import { useId } from 'react';
export default function FlowBot({state='idle',size=64}) {
 const uid='flow-bot-'+useId().replace(/:/g,'');
 return (<svg className={`ecb-root state-${state}`} aria-hidden="true" viewBox="0 0 240 240" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
  <linearGradient id={uid+'ecbEnvBackGrad'} x1="40" y1="95" x2="200" y2="195" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stopColor="var(--ecb-primary-dark)" />
  <stop offset="100%" stopColor="var(--ecb-primary-dark)" />
  </linearGradient>
  <linearGradient id={uid+'ecbEnvFrontLeft'} x1="44" y1="112" x2="140" y2="192" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stopColor="var(--ecb-primary)" />
  <stop offset="100%" stopColor="var(--ecb-primary-dark)" />
  </linearGradient>
  <linearGradient id={uid+'ecbEnvFrontRight'} x1="196" y1="112" x2="100" y2="192" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stopColor="var(--ecb-primary)" stopOpacity="0.92" />
  <stop offset="100%" stopColor="var(--ecb-primary-dark)" />
  </linearGradient>
  <linearGradient id={uid+'ecbEnvBottom'} x1="120" y1="138" x2="120" y2="196" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stopColor="var(--ecb-secondary)" stopOpacity="0.35" />
  <stop offset="15%" stopColor="var(--ecb-primary)" />
  <stop offset="100%" stopColor="var(--ecb-primary-dark)" />
  </linearGradient>
  <linearGradient id={uid+'ecbBotHeadGrad'} x1="85" y1="50" x2="155" y2="125" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stopColor="#ffffff" />
  <stop offset="70%" stopColor="var(--ecb-bot-body)" />
  <stop offset="100%" stopColor="#cbd5e1" />
  </linearGradient>
  <linearGradient id={uid+'ecbGlowGrad'} x1="0%" y1="0%" x2="100%" y2="100%">
  <stop offset="0%" stopColor="var(--ecb-secondary)" />
  <stop offset="100%" stopColor="var(--ecb-primary)" />
  </linearGradient>
  <filter id={uid+'ecbCyanGlow'} x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur stdDeviation="3.5" result="blur" />
  <feComposite in="SourceGraphic" in2="blur" operator="over" />
  </filter>
  <filter id={uid+'ecbDropShadow'} x="-15%" y="-15%" width="130%" height="140%">
  <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#090d16" floodOpacity="0.35" />
  </filter>
  <clipPath id={uid+'envelope-clip'}>
  <rect x="44" y="100" width="152" height="94" rx="14" ry="14" />
  </clipPath>
  </defs>
  <ellipse className="ecb-shadow" cx="120" cy="214" rx="58" ry="9" fill="#090d16" opacity="0.35" />
  <g className="ecb-master-float">
  <g className="ecb-sparkles">
  <path d="M52 46 L55 54 L63 57 L55 60 L52 68 L49 60 L41 57 L49 54 Z" fill="var(--ecb-secondary)" />
  <path d="M188 44 L190 50 L196 52 L190 54 L188 60 L186 54 L180 52 L186 50 Z" fill="var(--ecb-primary)" />
  <circle cx="72" cy="36" r="3" fill="var(--ecb-secondary)" />
  <circle cx="166" cy="34" r="2.5" fill="var(--ecb-primary)" />
  </g>
  <g className="ecb-badge-at" filter={`url(#${uid}ecbDropShadow)`}>
  <circle cx="42" cy="92" r="15" fill="var(--ecb-visor)" stroke="var(--ecb-secondary)" strokeWidth="2" />
  <text x="42" y="97" textAnchor="middle" fill="var(--ecb-secondary)" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="15">@</text>
  </g>
  <g filter={`url(#${uid}ecbDropShadow)`}>
  <path d="M44 114 L44 180 A14 14 0 0 0 58 194 L182 194 A14 14 0 0 0 196 180 L196 114 Z" fill={`url(#${uid}ecbEnvBackGrad)`} stroke="var(--ecb-primary-dark)" strokeWidth="1.5" strokeLinejoin="round" />
  <path className="ecb-env-flap" d="M44 114 L111 66 C116.5 62 123.5 62 129 66 L196 114 Z" fill={`url(#${uid}ecbEnvBackGrad)`} stroke="var(--ecb-primary)" strokeWidth="1.5" strokeLinejoin="round" />
  <line x1="56" y1="124" x2="184" y2="124" stroke="var(--ecb-secondary)" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="4 4" />
  </g>
  <g className="ecb-bot-group" filter={`url(#${uid}ecbDropShadow)`}>
  <circle className="ecb-signal-ring" cx="120" cy="32" r="9" fill="none" stroke="var(--ecb-secondary)" strokeWidth="2.2" />
  <line x1="120" y1="50" x2="120" y2="35" stroke="#cbd5e1" strokeWidth="4.5" strokeLinecap="round" />
  <circle className="ecb-antenna-orb" cx="120" cy="32" r="6.5" fill="var(--ecb-secondary)" filter={`url(#${uid}ecbCyanGlow)`} />
  <circle cx="118" cy="30" r="2" fill="#ffffff" />
  <rect x="65" y="73" width="10" height="24" rx="5" fill="var(--ecb-primary)" stroke="#ffffff" strokeWidth="1.5" />
  <rect x="165" y="73" width="10" height="24" rx="5" fill="var(--ecb-primary)" stroke="#ffffff" strokeWidth="1.5" />
  <rect x="72" y="48" width="96" height="76" rx="28" fill={`url(#${uid}ecbBotHeadGrad)`} stroke="#e2e8f0" strokeWidth="2" />
  <rect x="110" y="54" width="20" height="3" rx="1.5" fill="#94a3b8" opacity="0.5" />
  <rect x="82" y="62" width="76" height="44" rx="18" fill="var(--ecb-visor)" stroke="#334155" strokeWidth="2" />
  <path d="M92 67 H148" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
  <g className="ecb-eyes-normal" filter={`url(#${uid}ecbCyanGlow)`}>
  <rect x="96" y="75" width="13" height="17" rx="6.5" fill="var(--ecb-secondary)" />
  <circle cx="100" cy="79" r="2.2" fill="#ffffff" />
  <rect x="131" y="75" width="13" height="17" rx="6.5" fill="var(--ecb-secondary)" />
  <circle cx="135" cy="79" r="2.2" fill="#ffffff" />
  </g>
  <g className="ecb-eyes-happy" filter={`url(#${uid}ecbCyanGlow)`}>
  <path d="M94 86 Q102.5 74 111 86" stroke="var(--ecb-secondary)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
  <path d="M129 86 Q137.5 74 146 86" stroke="var(--ecb-secondary)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
  <ellipse cx="91" cy="92" rx="4.5" ry="2.5" fill="#f43f5e" opacity="0.7" />
  <ellipse cx="149" cy="92" rx="4.5" ry="2.5" fill="#f43f5e" opacity="0.7" />
  </g>
  </g>
  <g className="ecb-letter-sheet">
  <rect x="86" y="106" width="68" height="44" rx="6" fill="#ffffff" stroke="var(--ecb-secondary)" strokeWidth="2" />
  <line x1="96" y1="116" x2="126" y2="116" stroke="var(--ecb-primary)" strokeWidth="3" strokeLinecap="round" />
  <line x1="96" y1="124" x2="144" y2="124" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
  <line x1="96" y1="132" x2="136" y2="132" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
  </g>
  <g>
  <g clipPath={`url(#${uid}envelope-clip)`}>
  <path d="M44 114 L124 162 L58 194 A14 14 0 0 1 44 180 L44 114 Z" fill={`url(#${uid}ecbEnvFrontLeft)`} />
  <path d="M196 114 L116 162 L182 194 A14 14 0 0 0 196 180 L196 114 Z" fill={`url(#${uid}ecbEnvFrontRight)`} />
  <path d="M44 180 A14 14 0 0 0 58 194 L182 194 A14 14 0 0 0 196 180 L192 190 L128 146 C123 142.5 117 142.5 112 146 L48 190 Z" fill={`url(#${uid}ecbEnvBottom)`} />
  <path d="M44 114 L120 158 L196 114" stroke="var(--ecb-secondary)" strokeWidth="1.5" strokeOpacity="0.5" fill="none" strokeLinecap="round" />
  </g>
  <path d="M44 114 L44 180 A14 14 0 0 0 58 194 L182 194 A14 14 0 0 0 196 180 L196 114" stroke="var(--ecb-primary)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  <circle cx="120" cy="158" r="11" fill="var(--ecb-visor)" stroke="var(--ecb-secondary)" strokeWidth="2" />
  <path d="M115 158 L118.5 161.5 L125.5 154.5" stroke="var(--ecb-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </g>
  <g className="ecb-chat-bubble" filter={`url(#${uid}ecbDropShadow)`}>
  <rect x="148" y="34" width="64" height="38" rx="14" fill="#ffffff" stroke="var(--ecb-secondary)" strokeWidth="2.5" />
  <path d="M158 72 L150 82 L168 72 Z" fill="#ffffff" stroke="var(--ecb-secondary)" strokeWidth="2" strokeLinejoin="round" />
  <path d="M156 71 L169 71" stroke="#ffffff" strokeWidth="3" />
  <circle className="ecb-dot-1" cx="167" cy="53" r="4" fill="var(--ecb-primary)" />
  <circle className="ecb-dot-2" cx="180" cy="53" r="4" fill="var(--ecb-primary)" />
  <circle className="ecb-dot-3" cx="193" cy="53" r="4" fill="var(--ecb-secondary)" />
  </g>
  <g className="ecb-notif-badge" filter={`url(#${uid}ecbDropShadow)`}>
  <circle cx="192" cy="114" r="14" fill="#f43f5e" stroke="#ffffff" strokeWidth="2.5" />
  <text x="192" y="119" textAnchor="middle" fill="#ffffff" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="14">1</text>
  </g>
  <g className="ecb-paper-plane" filter={`url(#${uid}ecbDropShadow)`}>
  <path d="M184 96 L214 84 L200 112 L195 101 Z" fill="var(--ecb-secondary)" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
  <path d="M214 84 L195 101" stroke="var(--ecb-primary-dark)" strokeWidth="1.5" />
  </g>
  </g>
  </svg>);
  }

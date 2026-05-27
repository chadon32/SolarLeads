export function EnergyLines() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        viewBox="0 0 1200 900"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-85"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="energy-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fff7d9" stopOpacity="0" />
            <stop offset="35%" stopColor="#67e8f9" stopOpacity="0.7" />
            <stop offset="55%" stopColor="#38bdf8" stopOpacity="1" />
            <stop offset="75%" stopColor="#a5f3fc" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0" />
          </linearGradient>
          <filter id="energy-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M 145 625 C 315 580, 390 470, 520 355 S 720 205, 880 248 S 1030 365, 1110 510"
          fill="none"
          stroke="url(#energy-line)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="18 18"
          filter="url(#energy-glow)"
          className="energy-line-animate"
        />
        <path
          d="M 100 680 C 270 615, 345 530, 470 405 S 700 245, 845 290 S 980 420, 1135 560"
          fill="none"
          stroke="url(#energy-line)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="12 20"
          filter="url(#energy-glow)"
          className="energy-line-animate energy-line-delay"
        />
        <path
          d="M 220 530 C 350 480, 430 425, 540 330 S 735 190, 920 225 S 1065 320, 1120 420"
          fill="none"
          stroke="url(#energy-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="8 22"
          filter="url(#energy-glow)"
          className="energy-line-animate energy-line-slow"
        />

        <circle cx="920" cy="228" r="7" fill="#67e8f9" filter="url(#energy-glow)">
          <animate attributeName="r" values="6;9;6" dur="2.8s" repeatCount="indefinite" />
        </circle>
        <circle cx="540" cy="332" r="5" fill="#38bdf8" filter="url(#energy-glow)">
          <animate attributeName="r" values="4;7;4" dur="2.2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

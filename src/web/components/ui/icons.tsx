/** Quelques icônes au trait (24 × 24), dessinées dans la couleur du texte ; embarquées dans l'app (aucun chargement). */
const Svg = ({ size = 18, children }: { size?: number; children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const IconSun = ({ size }: { size?: number }) => (
  <Svg size={size}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const IconMoon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Svg>
);
export const IconAuto = ({ size }: { size?: number }) => (
  <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" /></Svg>
);
export const IconMenu = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const IconUser = ({ size }: { size?: number }) => (
  <Svg size={size}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>
);
export const IconChevronDown = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}><path d="m6 9 6 6 6-6" /></Svg>
);

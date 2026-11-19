const paths = {
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4.2" height="15" rx="1" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1" />
    </g>
  ),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  bookmark: <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />,
  bookmarkFill: <path d="M6.5 4h11v16l-5.5-4-5.5 4z" fill="currentColor" />,
  users: (<><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 5.2a3.5 3.5 0 010 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></>),
  chat: <path d="M4 5.5h16v11H9l-5 4z" />,
  send: <path d="M4 12l16-7.5-6 16-2.5-6.5z" />,
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" /></>),
  link: (<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: (<><path d="M14 4.5h4.5v15H14" /><path d="M10 8l-4 4 4 4M6 12h10" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" /></>),
  user: (<><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" /></>),
  fullscreen: <path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" />,
  volume: (<><path d="M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5z" fill="currentColor" /><path d="M16 9a4.2 4.2 0 010 6M18.5 6.5a8 8 0 010 11" /></>),
  mute: (<><path d="M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5z" fill="currentColor" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" /></>),
  sync: (<><path d="M19.5 11a7.5 7.5 0 00-13.6-3.8M4.5 13a7.5 7.5 0 0013.6 3.8" /><path d="M5.5 3.5v4h4M18.5 20.5v-4h-4" /></>),
  crown: <path d="M4 18h16M4.5 15.5L3 7l5 3.5L12 4.5l4 6L21 7l-1.5 8.5z" />,
  door: (<><path d="M5 20.5h14M7 20.5V4h10v16.5" /><circle cx="14" cy="12.5" r=".9" fill="currentColor" /></>),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (<><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.2v.3" /></>),
  film: (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>),
  unlock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 017.6-1.7" /></>),
  remove: (<><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 10h6" /></>),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  wifiOff: (<><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 017 0M5 12.8a10 10 0 015-2.6M14.2 10.3a10 10 0 014.8 2.5M2 9a14.5 14.5 0 016.2-3.5M15 5.4A14.5 14.5 0 0122 9" /><circle cx="12" cy="20" r=".8" fill="currentColor" /></>),
  globe: (<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.3 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.3-3.9-8.5S9.4 5.9 12 3.5z" /></>),
  bell: (<><path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4 6.5h.5M4 12h.5M4 17.5h.5" />,
  flag: (<><path d="M6 21V4.5" /><path d="M6 5h11l-2 4 2 4H6" /></>),
  shield: <path d="M12 3.5l7 2.5v5.5c0 4.2-2.8 7.6-7 9-4.2-1.4-7-4.8-7-9V6z" />,
  trash: (<><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  skip: (<><path d="M5 5v14l10-7z" fill="currentColor" stroke="none" /><path d="M19 5v14" /></>),
  thumb: <path d="M7 10.5v9H4v-9zM7 10.5l4-7c1.5 0 2.5 1 2.2 2.5L12.7 9H19a1.5 1.5 0 011.5 1.8l-1.3 7A2 2 0 0117.200 19.500H7" />,
  history: (<><path d="M4 12a8 8 0 108-8 8.500 8.500 0 00-6 2.500L4 8.500" /><path d="M4 4v4.500h4.500M12 8v4.500l3 1.500" /></>),
  mic: (<><path d="M3 3l18 18" /><path d="M9 9v3a3 3 0 005 2.100M15 11V6a3 3 0 00-5.700-1.300M6 11a6 6 0 009 5.200M12 18v3" /></>),
  mail: (<><rect x="3.5" y="5.500" width="17" height="13" rx="2" /><path d="M4 7l8 6 8-6" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
};

export default function Icon({ name, size = 20, strokeWidth = 1.8, className, label }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2a2549" />
      <path d="M9 8.5v15l11-7.5z" fill="#F4B740" />
      <path d="M14 8.5v15l11-7.5z" fill="#63D2C1" opacity=".85" />
    </svg>
  );
}

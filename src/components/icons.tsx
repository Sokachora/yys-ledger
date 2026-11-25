import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconInstances(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  );
}

export function IconTools(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </Svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </Svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Svg>
  );
}

export function IconFocus(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L18 10a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 6.5 3 3" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="m6 7 1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </Svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 6.7" />
      <path d="M20 5v6h-6" />
    </Svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12 5 5 9-10" />
    </Svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.75h.01" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h4l5-4v14l-5-4H4V9Z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" />
    </Svg>
  );
}

export function IconVolumeOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h4l5-4v14l-5-4H4V9Z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </Svg>
  );
}

type P = { size?: number }
const svg = (size: number, children: React.ReactNode, sw = 2) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const BackIcon = ({ size = 20 }: P) => svg(size, <path d="M15 18l-6-6 6-6" />, 2.2)
export const LockIcon = ({ size = 14 }: P) => svg(size, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 2.4)
export const CheckCircle = ({ size = 40 }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>, 2.2)
export const Sparkle = ({ size = 16 }: P) => svg(size, <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />)
export const Gear = ({ size = 20 }: P) =>
  svg(size, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, 1.8)
export const CopyIcon = ({ size = 18 }: P) => svg(size, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>)
export const ShareIcon = ({ size = 18 }: P) => svg(size, <><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>)
export const BellIcon = ({ size = 18 }: P) => svg(size, <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>)
export const ScratchHint = ({ size = 28 }: P) => svg(size, <><path d="M4 14c3-4 5-4 7 0s4 4 7 0" /><path d="M4 9c3-4 5-4 7 0s4 4 7 0" /></>)

export function Logo({ size = 40 }: P) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#17241C" />
      <rect x="13" y="13" width="17" height="17" rx="4" fill="#DCE8DF" />
      <rect x="34" y="13" width="17" height="17" rx="4" fill="#F2C46B" />
      <rect x="13" y="34" width="17" height="17" rx="4" fill="#F2C46B" />
      <rect x="34" y="34" width="17" height="17" rx="4" fill="#DCE8DF" />
    </svg>
  )
}

/** The Face ID outline: corner brackets around a simple face. */
export const FaceIdIcon = ({ size = 28 }: P) =>
  svg(
    size,
    <>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M8.5 9v1.2M15.5 9v1.2M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0" />
    </>,
    1.8,
  )

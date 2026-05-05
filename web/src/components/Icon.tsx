import type { ReactElement, SVGProps } from 'react'

export type IconName =
  | 'account'
  | 'admin'
  | 'audio'
  | 'camera'
  | 'chat'
  | 'check'
  | 'chevronDown'
  | 'delete'
  | 'document'
  | 'download'
  | 'edit'
  | 'export'
  | 'fileText'
  | 'image'
  | 'key'
  | 'logout'
  | 'plus'
  | 'qr'
  | 'save'
  | 'script'
  | 'search'
  | 'send'
  | 'shield'
  | 'upload'
  | 'user'
  | 'video'

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
}

const iconPaths: Record<IconName, ReactElement> = {
  account: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.4" />
      <path d="M10 18h4" />
      <path d="M10.5 6h3" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3l7 3v5c0 4.3-2.8 7.6-7 9-4.2-1.4-7-4.7-7-9V6l7-3z" />
      <path d="M9.5 12.2l1.7 1.7 3.5-4" />
    </>
  ),
  audio: (
    <>
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </>
  ),
  camera: (
    <>
      <path d="M7 7h2l1.3-2h3.4L15 7h2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  chat: (
    <>
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H11l-4.2 3.2V15H8.5A3.5 3.5 0 0 1 5 11.5v-5z" />
      <path d="M9 8h6" />
      <path d="M9 11h4" />
    </>
  ),
  check: (
    <>
      <path d="M5 12.5l4 4L19 6" />
    </>
  ),
  chevronDown: (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
  delete: (
    <>
      <path d="M5 7h14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M8 7l1-3h6l1 3" />
      <path d="M7 7l1 14h8l1-14" />
    </>
  ),
  document: (
    <>
      <path d="M7 3h6l4 4v14H7V3z" />
      <path d="M13 3v5h5" />
      <path d="M9.5 12h5" />
      <path d="M9.5 15h5" />
      <path d="M9.5 18h3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  edit: (
    <>
      <path d="M5 19l4.2-1 9.1-9.1a2.1 2.1 0 0 0-3-3L6.2 15 5 19z" />
      <path d="M13.8 7.4l2.8 2.8" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </>
  ),
  fileText: (
    <>
      <path d="M7 3h6l4 4v14H7V3z" />
      <path d="M13 3v5h5" />
      <path d="M9.5 12h5" />
      <path d="M9.5 15h5" />
      <path d="M9.5 18h3" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="M6.5 17l4.2-4.2 2.8 2.8 1.8-1.8 2.2 3.2" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="13.5" r="3.5" />
      <path d="M11 11l8-8" />
      <path d="M16 6l2 2" />
      <path d="M14 8l2 2" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  qr: (
    <>
      <path d="M4 4h6v6H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6H4z" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h2v6h-4v-2h2z" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h12l2 2v14H5V4z" />
      <path d="M8 4v6h8" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  script: (
    <>
      <path d="M8 4h9a2 2 0 0 1 2 2v13H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" />
      <path d="M8 16h11" />
      <path d="M9.5 8h5" />
      <path d="M9.5 11h6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="5.8" />
      <path d="M15 15l4 4" />
    </>
  ),
  send: (
    <>
      <path d="M4 11.5L20 4l-4.8 16-3.1-6.2L4 11.5z" />
      <path d="M12.1 13.8L20 4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.3-2.8 7.6-7 9-4.2-1.4-7-4.7-7-9V6l7-3z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V9" />
      <path d="M8 13l4-4 4 4" />
      <path d="M5 5h14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  video: (
    <>
      <rect x="4" y="6" width="12" height="12" rx="2.5" />
      <path d="M16 10l4-2.5v9L16 14" />
    </>
  ),
}

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      className={className ? `app-icon ${className}` : 'app-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {iconPaths[name]}
    </svg>
  )
}

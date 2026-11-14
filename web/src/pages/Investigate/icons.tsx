// Inline SVG icons drawn for this page: 24 x 24, 1.75 px stroke, currentColor, decorative.
import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="investigate-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function PinIcon() {
  return (
    <Icon>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </Icon>
  )
}

export function MagnifierIcon() {
  return (
    <Icon>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </Icon>
  )
}

export function CalendarIcon() {
  return (
    <Icon>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  )
}

/** Thermometer. */
function HeatIcon() {
  return (
    <Icon>
      <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" />
      <path d="M12 9v7" />
    </Icon>
  )
}

/** Cloud with drops. */
function RainIcon() {
  return (
    <Icon>
      <path d="M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 0 7z" />
      <path d="M8 18.5v2M12 18.5v2M16 18.5v2" />
    </Icon>
  )
}

/** Soil layers with a drop. */
function SoilIcon() {
  return (
    <Icon>
      <path d="M12 3s4 4.2 4 6.8a4 4 0 0 1-8 0C8 7.2 12 3 12 3z" />
      <path d="M3.5 17.5h17M5.5 21h13" />
    </Icon>
  )
}

/** Waves of vapour. */
function MoistureIcon() {
  return (
    <Icon>
      <path d="M3.5 8c2-2 3.500-2 5.500 0s3.500 2 5.500 0 3.500-2 5.500 0" />
      <path d="M3.5 13c2-2 3.500-2 5.500 0s3.500 2 5.500 0 3.500-2 5.500 0" />
      <path d="M3.5 18c2-2 3.500-2 5.500 0s3.500 2 5.500 0 3.500-2 5.500 0" />
    </Icon>
  )
}

/** Four squares: "everything" and any category without its own picture. */
function GridIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </Icon>
  )
}

export function TopicIcon({ id }: { id: string }) {
  switch (id) {
    case 'heat':
      return <HeatIcon />
    case 'rain':
      return <RainIcon />
    case 'drought':
      return <SoilIcon />
    case 'moisture':
      return <MoistureIcon />
    default:
      return <GridIcon />
  }
}

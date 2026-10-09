import type { SVGProps } from 'react';

interface FaceToFaceIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/** Two people face to face (the owner's pick, 2026-10-09): drawn in lucide's grid and stroke so it sits beside the library's icons. */
export function FaceToFaceIcon({ size = 24, ...props }: FaceToFaceIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M8 11.5V15H5.5A4 4 0 1 1 8.8 8.2L10 11.5Z" />
      <path d="M16 11.5V15H18.5A4 4 0 1 0 15.2 8.2L14 11.5Z" />
      <path d="M2.5 21a4 3 0 0 1 8 0" />
      <path d="M13.5 21a4 3 0 0 1 8 0" />
    </svg>
  );
}

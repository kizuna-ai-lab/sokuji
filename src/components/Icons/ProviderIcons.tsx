import React from 'react';

interface IconProps {
  size?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * OpenAI logo from LobeHub icons (monochrome - OpenAI brand has no color variant)
 * @see https://lobehub.com/icons/openai
 */
export const OpenAIIcon: React.FC<IconProps> = ({ size = 24, className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    fillRule="evenodd"
    className={className}
    style={style}
  >
    <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
  </svg>
);

/**
 * Google Gemini colored star from LobeHub icons
 * @see https://lobehub.com/icons/gemini
 */
export const GeminiIcon: React.FC<IconProps> = ({ size = 24, className, style }) => {
  const uid = React.useId?.() || Math.random().toString(36).slice(2);
  const fill0 = `gemini-fill-0-${uid}`;
  const fill1 = `gemini-fill-1-${uid}`;
  const fill2 = `gemini-fill-2-${uid}`;
  const starPath = 'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
    >
      <path d={starPath} fill="#3186FF" />
      <path d={starPath} fill={`url(#${fill0})`} />
      <path d={starPath} fill={`url(#${fill1})`} />
      <path d={starPath} fill={`url(#${fill2})`} />
      <defs>
        <linearGradient id={fill0} x1="7" x2="11" y1="15.5" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#08B962" />
          <stop offset="1" stopColor="#08B962" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fill1} x1="8" x2="11.5" y1="5.5" y2="11" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F94543" />
          <stop offset="1" stopColor="#F94543" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fill2} x1="3.5" x2="17.5" y1="13.5" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FABC12" />
          <stop offset=".46" stopColor="#FABC12" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
};

/**
 * Palabra.ai official colored "P" logo (from palabra.ai website)
 * Not available in LobeHub icons
 */
export const PalabraAIIcon: React.FC<IconProps> = ({ size = 24, className, style }) => {
  const uid = React.useId?.() || Math.random().toString(36).slice(2);
  const gradientId = `palabra-grad-${uid}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 33 38"
      fill="none"
      className={className}
      style={style}
    >
      <path
        d="M32.9937 5.754V17.529c0 3.023-2.357 5.473-5.265 5.473H17.97l5.534-8.685H15.013L21.814.281h5.915c2.908 0 5.265 2.453 5.265 5.473Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M23.503 14.32 17.97 23.005 8.55 37.784V23.027H5.265C2.351 23.023-.009 20.564 0 17.536L.03 5.738C.042 2.725 2.399.281 5.295.281H21.814L15.016 14.32h8.49Z"
        fill="#F84C1B"
      />
      <defs>
        <linearGradient id={gradientId} x1="30.879" y1="21.925" x2="17.772" y2="3.097" gradientUnits="userSpaceOnUse">
          <stop stopColor="#222AC1" />
          <stop offset="1" stopColor="#161377" />
        </linearGradient>
      </defs>
    </svg>
  );
};

/** Kizuna AI logo - uses the project's own brand icon (not in LobeHub) */
export const KizunaAIIcon: React.FC<IconProps> = ({ size = 24, className, style }) => (
  <img
    src={new URL('../../assets/logo.png', import.meta.url).href}
    alt="Kizuna AI"
    width={size}
    height={size}
    className={className}
    style={{ borderRadius: '4px', objectFit: 'contain', ...style }}
  />
);

/**
 * Volcengine (火山引擎) colored mountain logo from LobeHub icons
 * @see https://lobehub.com/icons/volcengine
 */
export const VolcengineIcon: React.FC<IconProps> = ({ size = 24, className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
  >
    <path d="M19.44 10.153l-2.936 11.586a.215.215 0 00.214.261h5.87a.215.215 0 00.214-.261l-2.95-11.586a.214.214 0 00-.412 0zM3.28 12.778l-2.275 8.96A.214.214 0 001.22 22h4.532a.212.212 0 00.214-.165.214.214 0 000-.097l-2.276-8.96a.214.214 0 00-.41 0z" fill="#00E5E5" />
    <path d="M7.29 5.359L3.148 21.738a.215.215 0 00.203.261h8.29a.214.214 0 00.215-.261L7.7 5.358a.214.214 0 00-.41 0z" fill="#006EFF" />
    <path d="M14.44.15a.214.214 0 00-.41 0L8.366 21.739a.214.214 0 00.214.261H19.9a.216.216 0 00.171-.078.214.214 0 00.044-.183L14.439.15z" fill="#006EFF" />
    <path d="M10.278 7.741L6.685 21.736a.214.214 0 00.214.264h7.17a.215.215 0 00.214-.264L10.688 7.741a.214.214 0 00-.41 0z" fill="#00E5E5" />
  </svg>
);

/**
 * Zoom brand mark: Zoom-blue rounded square with a white video-camera glyph.
 * @see https://brand.zoom.us
 */
export const ZoomIcon: React.FC<IconProps> = ({ size = 24, className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
  >
    <rect width="24" height="24" rx="5" fill="#0B5CFF" />
    <path
      d="M6.2 8h6.1c.663 0 1.2.537 1.2 1.2v5.6c0 .663-.537 1.2-1.2 1.2H6.2c-.663 0-1.2-.537-1.2-1.2V9.2C5 8.537 5.537 8 6.2 8zm8.5 2.26l3.2-2.33c.278-.203.66-.006.66.331v7.478c0 .337-.382.534-.66.331l-3.2-2.33v-3.48z"
      fill="#fff"
    />
  </svg>
);

/**
 * Official Soniox brand mark — the navy "S" on a white rounded square, taken
 * verbatim from soniox.com/icons/favicon.svg. The white badge keeps the navy
 * glyph legible on the dark provider list (a bare navy S would sink into it).
 */
export const SonioxIcon: React.FC<IconProps> = ({ size = 18, className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    fill="none"
    className={className}
    style={style}
  >
    <rect width="1024" height="1024" rx="212" fill="#fff" />
    <path
      d="M221 759.071L307.504 618.58C383.282 668.755 466.326 694.362 534.491 694.362C574.629 694.362 592.968 682.251 592.968 659.066V656.644C592.968 631.037 556.29 619.964 486.741 600.24C356.293 565.982 252.488 522.035 252.488 388.81V386.042C252.488 245.551 364.943 167 517.19 167C613.729 167 713.728 195.029 789.505 244.167L710.268 390.887C641.756 352.822 567.363 329.638 515.114 329.638C479.82 329.638 461.482 343.133 461.482 361.473V363.896C461.482 389.503 499.197 401.96 568.747 422.722C699.195 459.402 803 504.733 803 633.113V635.536C803 781.218 694.351 857 533.107 857C422.382 856.654 312.694 825.164 221 759.071Z"
      fill="#263971"
    />
  </svg>
);

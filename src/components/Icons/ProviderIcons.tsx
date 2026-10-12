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

/* ------------------------------------------------------------------------ *
 * Kizuna-hosted composites — "Kizuna AI, powered by <vendor>"
 * ------------------------------------------------------------------------ */

/**
 * Badge edge as a fraction of the icon's edge — 14px at the 24px selected row,
 * 12px in the 20px dropdown rows.
 *
 * What the badge eats as it grows is the three motion strokes at the top right
 * of the Kizuna mark: at 0.52 it covers the lowest one, at 0.58 two of three,
 * and past ~0.64 it takes all three and starts clipping the signature stroke
 * itself. 0.58 is therefore the ceiling — the strokes are decorative, the
 * signature is the identity, and the identity stays whole.
 *
 * There is a second ceiling and it is the reason this is a badge at all: BYOK
 * Soniox sits in the same list as the managed twin, and the Kizuna mark being
 * the dominant one is what keeps those two rows apart. Enlarging the badge
 * walks toward the inverted design, so it does not get to grow freely.
 */
export const HOSTED_BADGE_RATIO = 0.58;

/** Mirrors $bg-surface in Settings/shared/_variables.scss. */
const BADGE_RING = '#252525';

interface HostedBadgeOptions {
  /**
   * Vendor marks with a transparent background need an opaque plate to read
   * over the Kizuna artwork. Soniox's own mark is already a white square.
   */
  plate?: boolean;
  /** Forced onto marks painted with `currentColor` — see below. */
  color?: string;
}

/**
 * Composes a Kizuna-managed provider's mark: the Kizuna logo carries the
 * identity at full size, and the third-party engine it runs on rides along as
 * a ringed corner badge. Without this the three managed twins all render the
 * bare Kizuna logo and are indistinguishable in the provider dropdown.
 */
export function kizunaHostedIcon(
  VendorIcon: React.FC<IconProps>,
  { plate = false, color }: HostedBadgeOptions = {},
): React.FC<IconProps> {
  const HostedIcon: React.FC<IconProps> = ({ size = 24, className, style }) => {
    // Sizes stay CSS dimensions rather than becoming numbers. IconProps.size is
    // `string | number` and every other icon in this file hands the value
    // straight to the svg's width/height, so `1em` and `100%` work there;
    // parsing it here turned `1em` into 1, i.e. a one-pixel badge. calc() keeps
    // the arithmetic without leaving CSS.
    const edge = typeof size === 'number' ? `${size}px` : size;
    const badge = `calc(${edge} * ${HOSTED_BADGE_RATIO})`;
    // A plated mark is inset inside its plate; a bare one fills the badge.
    // Soniox's own mark is already a rounded square, and the plate's radius is
    // a percentage of its own box, so the badge reads as one shape either way.
    const mark = plate ? `calc(${badge} * 0.7)` : badge;

    return (
      <span
        className={['hosted-provider-icon', className].filter(Boolean).join(' ')}
        style={{
          position: 'relative',
          display: 'inline-block',
          width: edge,
          height: edge,
          flexShrink: 0,
          ...style,
        }}
      >
        <KizunaAIIcon size={edge} />
        <span
          className="hosted-provider-icon__badge"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: badge,
            height: badge,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '22%',
            // Separates the badge from the artwork behind it. The badge sits
            // over the logo rather than the panel, so a fixed neutral holds up
            // through the row's hover state too.
            boxShadow: `0 0 0 1.5px ${BADGE_RING}`,
            ...(plate ? { background: '#fff' } : null),
          }}
        >
          <VendorIcon
            size={mark}
            style={{
              // Inline, not via the svg's width/height attributes:
              // `.provider-icon svg { width: 24px }` in Settings.scss outranks
              // those attributes and would stretch the badge to full size,
              // burying the Kizuna logo. Inline styles outrank the stylesheet.
              width: mark,
              height: mark,
              display: 'block',
              // `.provider-icon { color: $text-muted }` cascades in here and
              // would paint a currentColor mark #888 on a white plate.
              ...(color ? { color } : null),
            }}
          />
        </span>
      </span>
    );
  };
  HostedIcon.displayName = `KizunaHosted(${VendorIcon.displayName || VendorIcon.name || 'Vendor'})`;
  return HostedIcon;
}


/** Qwen's mark (@lobehub/icons-static-svg 1.70.0, `qwen-color.svg`, MIT), its gradient id made unique per instance. */
export const QwenIcon: React.FC<IconProps> = ({ size = 24, className, style }) => {
  const uid = React.useId?.() || Math.random().toString(36).slice(2);
  const fill = `qwen-fill-${uid}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" className={className} style={style}>
      <path
        d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"
        fill={`url(#${fill})`}
        fillRule="nonzero"
      />
      <defs>
        <linearGradient id={fill} x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="#6336E7" stopOpacity=".84" />
          <stop offset="100%" stopColor="#6F69F7" stopOpacity=".84" />
        </linearGradient>
      </defs>
    </svg>
  );
};

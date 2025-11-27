/**
 * Logo Component
 *
 * Renders the Sokuji logo at specified size.
 */

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <img
      src="/favicon.png"
      alt="Sokuji"
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: size > 100 ? '24px' : '6px' }}
    />
  );
}

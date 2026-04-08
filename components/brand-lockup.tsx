import Image from "next/image";

/**
 * Shared company brand lockup used across auth and workspace surfaces.
 *
 * Keeping the logo + wordmark in one component means the app can change brand
 * treatment in one place instead of repeating small variations throughout the
 * codebase.
 */
export function BrandLockup({
  size = "default",
  subtitle,
}: {
  size?: "default" | "compact";
  subtitle?: string;
}) {
  return (
    <div className={`brand-lockup ${size === "compact" ? "brand-lockup--compact" : ""}`}>
      <Image
        src="/schwifty-logo.png"
        alt="Schwifty logo"
        width={560}
        height={320}
        className="brand-lockup__logo"
        priority={size === "default"}
      />
      <div className="brand-lockup__copy">
        <strong>Schwifty</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
    </div>
  );
}

import Image from "next/image";

type Props = {
  name: string;
  logoUrl?: string | null;
  isZiki?: boolean;
  size?: number;
};

/** A platform's logo: Ziki's mark, an uploaded site-path logo, or the name's initial. */
export function PlatformBadge({ name, logoUrl, isZiki = false, size = 40 }: Props) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (isZiki) {
    return (
      <span className="cmp-logo cmp-logo-ziki" style={style} aria-hidden="true">
        <Image src="/homepage/ziki-mark.svg" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} alt="" />
      </span>
    );
  }
  if (logoUrl && logoUrl.startsWith("/")) {
    return (
      <span className="cmp-logo" style={style} aria-hidden="true">
        <Image src={logoUrl} width={Math.round(size * 0.64)} height={Math.round(size * 0.64)} alt="" unoptimized />
      </span>
    );
  }
  return (
    <span className="cmp-logo cmp-logo-initial" style={style} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

import { publicPhotoUrl } from '@arkilaunch/db';

type BrandingRow = { logoKey: string | null; heroKey: string | null; iconKey: string | null; font: string | null };
type Branding<T> = Omit<T, keyof BrandingRow> & {
  font: 'inter' | 'plex' | null;
  logoUrl: string | null;
  heroUrl: string | null;
  iconUrl: string | null;
};

export function toBranding<T extends BrandingRow>(row: T): Branding<T> {
  const { logoKey, heroKey, iconKey, font, ...rest } = row;
  return {
    ...rest,
    font: font === 'inter' || font === 'plex' ? font : null,
    logoUrl: publicPhotoUrl(logoKey),
    heroUrl: publicPhotoUrl(heroKey),
    iconUrl: publicPhotoUrl(iconKey),
  };
}

const CARD_MEDIA_HOST_HINTS = ['swu-db.com', 'swudb', 'starwarsunlimited'];
const CARD_MEDIA_PATH_HINTS = ['/cards/', '/card/', 'frontart'];

export function isCardMediaAvatarUrl(
  avatarUrl: string | null | undefined,
  favoriteCardImageUrl?: string | null
): boolean {
  const normalizedAvatar = String(avatarUrl ?? '').trim().toLowerCase();
  if (normalizedAvatar === '') return false;

  const normalizedFavoriteCardImage = String(favoriteCardImageUrl ?? '').trim().toLowerCase();
  if (normalizedFavoriteCardImage !== '' && normalizedAvatar === normalizedFavoriteCardImage) {
    return true;
  }

  return (
    CARD_MEDIA_HOST_HINTS.some((hostHint) => normalizedAvatar.includes(hostHint)) ||
    CARD_MEDIA_PATH_HINTS.some((pathHint) => normalizedAvatar.includes(pathHint))
  );
}

export function getAvatarObjectPosition(
  avatarUrl: string | null | undefined,
  favoriteCardImageUrl?: string | null
): string {
  return isCardMediaAvatarUrl(avatarUrl, favoriteCardImageUrl) ? 'center 22%' : 'center';
}

export function getAvatarObjectFit(
  avatarFitMode: string | null | undefined,
  avatarUrl: string | null | undefined,
  favoriteCardImageUrl?: string | null
): 'cover' | 'contain' {
  const normalized = String(avatarFitMode ?? '').trim().toLowerCase();
  if (normalized === 'contain') return 'contain';
  if (normalized === 'cover') return 'cover';
  return isCardMediaAvatarUrl(avatarUrl, favoriteCardImageUrl) ? 'cover' : 'cover';
}

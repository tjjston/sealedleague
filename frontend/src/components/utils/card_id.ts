export type CardLookupRow = {
  card_id?: string | null;
  name?: string | null;
  image_url?: string | null;
  [key: string]: unknown;
};

export function normalizeCardIdLookupKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function removeNumericPaddingFromCardId(value: unknown) {
  const normalized = normalizeCardIdLookupKey(value);
  const match = normalized.match(/^([a-z]+)-(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  const [, setCode, number, suffix] = match;
  return `${setCode}-${Number(number)}${suffix}`;
}

export function buildCardLookupKeys(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  const normalized = normalizeCardIdLookupKey(value);
  const noPadding = removeNumericPaddingFromCardId(value);
  return [raw, normalized, noPadding].filter((item, index, all) => item !== '' && all.indexOf(item) === index);
}

export function looksLikeCardId(value: unknown) {
  return /^[a-z]{2,5}-\d+[a-z]*$/i.test(normalizeCardIdLookupKey(value));
}

export function formatCardIdForDisplay(value: unknown) {
  const normalized = normalizeCardIdLookupKey(value);
  if (normalized === '') return '';
  const match = normalized.match(/^([a-z]+)-0*(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  const [, setCode, number, suffix] = match;
  return `${setCode.toUpperCase()}-${Number(number)}${String(suffix ?? '').toUpperCase()}`;
}

export function getCardSetCode(value: unknown): string | null {
  const normalized = normalizeCardIdLookupKey(value);
  if (normalized === '' || !normalized.includes('-')) return null;
  const [setCode] = normalized.split('-', 1);
  return setCode.trim() === '' ? null : setCode.trim();
}

export function buildCardLookupByKey<T extends CardLookupRow>(cards: T[]) {
  return cards.reduce((result: Record<string, T>, row: T) => {
    buildCardLookupKeys(row?.card_id).forEach((key) => {
      if (result[key] == null) result[key] = row;
    });
    return result;
  }, {});
}

export function resolveCardFromLookup<T extends CardLookupRow>(
  lookup: Record<string, T>,
  value: unknown
): T | null {
  const key = buildCardLookupKeys(value).find((candidate) => lookup[candidate] != null);
  return key == null ? null : lookup[key];
}

export function resolveCardLabel({
  explicitName,
  cardId,
  lookup,
  emptyLabel,
}: {
  explicitName: unknown;
  cardId?: unknown;
  lookup?: Record<string, CardLookupRow>;
  emptyLabel: string;
}) {
  const nameRaw = String(explicitName ?? '').trim();
  const matchingCard =
    lookup == null
      ? null
      : resolveCardFromLookup(lookup, cardId ?? nameRaw) ?? resolveCardFromLookup(lookup, nameRaw);
  const resolvedName = String(matchingCard?.name ?? '').trim();
  if (nameRaw !== '' && !looksLikeCardId(nameRaw)) return nameRaw;
  if (resolvedName !== '') return resolvedName;
  const fallbackId = String(cardId ?? nameRaw).trim();
  if (fallbackId !== '') return formatCardIdForDisplay(fallbackId);
  return emptyLabel;
}

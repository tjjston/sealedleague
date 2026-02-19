export type WeaponIconConfig = {
  value: string;
  label: string;
  iconPath: string;
  fallbackSymbol: string;
};

const ICON_FILE_PATHS = [
  // Legacy options (keep for existing user selections)
  '/icons/weapons/blaster_pistol.png',
  '/icons/weapons/blaster_rifle.png',
  '/icons/weapons/lightsaber_blue.png',
  '/icons/weapons/lightsaber_red.png',
  '/icons/weapons/lightsaber_green.png',
  '/icons/weapons/lightsaber_purple.png',
  '/icons/weapons/wrist_rockets.png',
  '/icons/weapons/electrostaff.png',
  // User icon folder
  '/icons/user-icons/bb-8.png',
  '/icons/user-icons/damage.png',
  '/icons/user-icons/death-star.png',
  '/icons/user-icons/icons8-baby-yoda-50.png',
  '/icons/user-icons/icons8-c-3po-50.png',
  '/icons/user-icons/icons8-chewbacca-50.png',
  '/icons/user-icons/icons8-death-star-50.png',
  '/icons/user-icons/icons8-empire-50.png',
  '/icons/user-icons/icons8-jedi-50.png',
  '/icons/user-icons/icons8-lightsaber-50-2.png',
  '/icons/user-icons/icons8-lightsaber-50-3.png',
  '/icons/user-icons/icons8-lightsaber-50.png',
  '/icons/user-icons/icons8-mandalorian-50.png',
  '/icons/user-icons/icons8-mando-50.png',
  '/icons/user-icons/icons8-r2-d2-50-2.png',
  '/icons/user-icons/icons8-r2-d2-50-3.png',
  '/icons/user-icons/icons8-r2-d2-50.png',
  '/icons/user-icons/icons8-rebel-50.png',
  '/icons/user-icons/icons8-star-wars-50-2.png',
  '/icons/user-icons/icons8-star-wars-50-3.png',
  '/icons/user-icons/icons8-star-wars-50-4.png',
  '/icons/user-icons/icons8-star-wars-50-5.png',
  '/icons/user-icons/icons8-star-wars-50-6.png',
  '/icons/user-icons/icons8-star-wars-50.png',
  '/icons/user-icons/icons8-star-wars-millenium-falcon-50.png',
  '/icons/user-icons/icons8-star-wars-naboo-ship-50.png',
  '/icons/user-icons/icons8-star-wars-rebellion-ship-50.png',
  '/icons/user-icons/icons8-t-65b-x-wing-starfighter-50.png',
  '/icons/user-icons/icons8-yoda-50.png',
  '/icons/user-icons/people.png',
  '/icons/user-icons/star-wars/Darth Vader Rogue One Star Wars Scene.ico',
  '/icons/user-icons/star-wars/Darth Vader Rogue One Star Wars.ico',
  '/icons/user-icons/star-wars/Kylo Ren Mask.ico',
  '/icons/user-icons/star-wars/Merry Sithmas.ico',
  '/icons/user-icons/star-wars/Porg Force Friday.ico',
  '/icons/user-icons/star-wars/Porgs & BB8 Star Wars.ico',
  '/icons/user-icons/star-wars/Yoda Porg Star Wars.ico',
  '/icons/user-icons/weapon.png',
] as const;

const FILE_EXTENSION_PATTERN = /\.[a-z0-9]+$/i;

function toIconValue(filePath: string) {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName
    .replace(FILE_EXTENSION_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toIconLabel(filePath: string) {
  const fileName = filePath.split('/').pop() ?? filePath;
  const normalized = fileName
    .replace(FILE_EXTENSION_PATTERN, '')
    .replace(/^icons8[-_]/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === '') return 'Icon';
  return normalized
    .split(' ')
    .map((token) =>
      token.length < 1 ? token : `${token.charAt(0).toUpperCase()}${token.slice(1)}`
    )
    .join(' ');
}

export const WEAPON_ICON_CONFIGS: WeaponIconConfig[] = ICON_FILE_PATHS.map((filePath) => ({
  value: toIconValue(filePath),
  label: toIconLabel(filePath),
  iconPath: encodeURI(filePath),
  fallbackSymbol: '',
})).sort((left, right) => left.label.localeCompare(right.label));

const WEAPON_ICON_MAP = new Map(
  WEAPON_ICON_CONFIGS.map((option) => [option.value, option])
);

export const WEAPON_ICON_OPTIONS = WEAPON_ICON_CONFIGS.map((option) => ({
  value: option.value,
  label: option.label,
}));

export function getWeaponIconConfig(value: string | null | undefined): WeaponIconConfig | null {
  if (value == null || value === '') {
    return null;
  }
  return WEAPON_ICON_MAP.get(value) ?? null;
}

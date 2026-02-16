export type WeaponIconConfig = {
  value: string;
  label: string;
  iconPath: string;
  fallbackSymbol: string;
};

export const WEAPON_ICON_CONFIGS: WeaponIconConfig[] = [
  {
    value: 'blaster_pistol',
    label: 'Blaster Pistol',
    iconPath: '/icons/weapons/blaster_pistol.png',
    fallbackSymbol: '🔫',
  },
  {
    value: 'blaster_rifle',
    label: 'Blaster Rifle',
    iconPath: '/icons/weapons/blaster_rifle.png',
    fallbackSymbol: '🛡️',
  },
  {
    value: 'lightsaber_blue',
    label: 'Blue Lightsaber',
    iconPath: '/icons/weapons/lightsaber_blue.png',
    fallbackSymbol: '🔵',
  },
  {
    value: 'lightsaber_red',
    label: 'Red Lightsaber',
    iconPath: '/icons/weapons/lightsaber_red.png',
    fallbackSymbol: '🔴',
  },
  {
    value: 'lightsaber_green',
    label: 'Green Lightsaber',
    iconPath: '/icons/weapons/lightsaber_green.png',
    fallbackSymbol: '🟢',
  },
  {
    value: 'lightsaber_purple',
    label: 'Purple Lightsaber',
    iconPath: '/icons/weapons/lightsaber_purple.png',
    fallbackSymbol: '🟣',
  },
  {
    value: 'wrist_rockets',
    label: 'Wrist Rockets',
    iconPath: '/icons/weapons/wrist_rockets.png',
    fallbackSymbol: '🚀',
  },
  {
    value: 'electrostaff',
    label: 'Electrostaff',
    iconPath: '/icons/weapons/electrostaff.png',
    fallbackSymbol: '⚡',
  },
];

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

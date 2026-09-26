import React from 'react';

export const ANONYMOUS_NAME_ANIMALS = [
  'Panda',
  'Otter',
  'Koala',
  'Penguin',
  'Bunny',
  'Dolphin',
  'Owl',
  'Fox',
  'Bear',
  'Deer',
  'Hedgehog',
  'Hamster',
  'Kitten',
  'Puppy',
  'Squirrel',
  'Raccoon',
  'Sloth',
  'Seal',
  'Duckling',
  'Fawn',
  'Lemur',
  'Alpaca',
  'Capybara',
  'Quokka',
  'Meerkat',
  'Chinchilla',
  'Ferret',
  'Beaver',
  'Badger',
  'Wombat',
] as const;

export type AnonymousAnimal = (typeof ANONYMOUS_NAME_ANIMALS)[number];

const ANIMAL_AVATAR_BASE_PATH = '/images/avatars/animals';

const ANIMAL_ICON_SLUGS: Record<AnonymousAnimal, string> = {
  Panda: 'panda',
  Otter: 'otter',
  Koala: 'koala',
  Penguin: 'penguin',
  Bunny: 'bunny',
  Dolphin: 'dolphin',
  Owl: 'owl',
  Fox: 'fox',
  Bear: 'bear',
  Deer: 'deer',
  Hedgehog: 'hedgehog',
  Hamster: 'hamster',
  Kitten: 'kitten',
  Puppy: 'puppy',
  Squirrel: 'squirrel',
  Raccoon: 'raccoon',
  Sloth: 'sloth',
  Seal: 'seal',
  Duckling: 'duckling',
  Fawn: 'fawn',
  Lemur: 'lemur',
  Alpaca: 'alpaca',
  Capybara: 'capybara',
  Quokka: 'quokka',
  Meerkat: 'meerkat',
  Chinchilla: 'chinchilla',
  Ferret: 'ferret',
  Beaver: 'beaver',
  Badger: 'badger',
  Wombat: 'wombat',
};

const AVATAR_TONES = [
  { bg: '#e8f0fe' },
  { bg: '#e6f4ea' },
  { bg: '#fef7e0' },
  { bg: '#fce8e6' },
  { bg: '#f3e8fd' },
  { bg: '#e4f7fb' },
  { bg: '#feefe3' },
  { bg: '#f1f3f4' },
];

export type AnimalAvatarIdentity = {
  id?: string | null;
  userId?: string | null;
  anonymousId?: string | null;
  anonymousDisplayName?: string | null;
  deviceId?: string | null;
};

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getAnimalFromDisplayName(displayName?: string | null): AnonymousAnimal | null {
  const normalized = (displayName || '').replace(/[\s_-]+/g, '').toLowerCase();
  if (!normalized) return null;
  return [...ANONYMOUS_NAME_ANIMALS]
    .sort((a, b) => b.length - a.length)
    .find((animal) => normalized.includes(animal.toLowerCase())) ?? null;
}

export function getAnimalForSeed(seed?: string | null): AnonymousAnimal {
  return ANONYMOUS_NAME_ANIMALS[hashString(seed || 'anonymous') % ANONYMOUS_NAME_ANIMALS.length];
}

export function getAnimalAvatarSeed(identity: AnimalAvatarIdentity): string {
  return (
    identity.deviceId?.trim()
    || identity.anonymousDisplayName?.trim()
    || identity.anonymousId?.trim()
    || identity.userId?.trim()
    || identity.id?.trim()
    || 'anonymous'
  );
}

export function getAnimalForIdentity(identity: AnimalAvatarIdentity): AnonymousAnimal {
  return getAnimalFromDisplayName(identity.anonymousDisplayName) ?? getAnimalForSeed(getAnimalAvatarSeed(identity));
}

export function getAnimalIconSrc(animal: AnonymousAnimal): string {
  return `${ANIMAL_AVATAR_BASE_PATH}/${ANIMAL_ICON_SLUGS[animal]}.svg`;
}

function getAvatarTone(seed: string) {
  return AVATAR_TONES[hashString(seed || 'anonymous') % AVATAR_TONES.length];
}

export function AnimalAvatar({
  animal,
  seed,
  size = 32,
  active = false,
  neutral = false,
  className = '',
}: {
  animal: AnonymousAnimal;
  seed: string;
  size?: number;
  active?: boolean;
  neutral?: boolean;
  className?: string;
}) {
  const tone = neutral ? { bg: '#f8fafd' } : getAvatarTone(seed);
  const innerSize = Math.max(14, Math.round(size * 0.68));

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-none border border-[#e8eaed] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: tone.bg,
        boxShadow: active ? '0 0 0 2px #1a73e8' : undefined,
      }}
      aria-hidden="true"
    >
      <img src={getAnimalIconSrc(animal)} alt="" width={innerSize} height={innerSize} className="block" loading="lazy" />
    </span>
  );
}

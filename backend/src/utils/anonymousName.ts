/**
 * Anonymous Name Generator
 * 
 * Generates deterministic, human-readable names for anonymous users
 * based on their deviceId fingerprint.
 * 
 * Format: {CuteAdjective}{Animal}{6alphanumeric}
 * Example: "FluffyPanda3A8B72", "SparklyOtter9C4E21"
 */

import { createHash } from 'crypto';

// Cute adjectives for fun, memorable names
const ADJECTIVES = [
    'Fluffy', 'Sparkly', 'Cozy', 'Snuggly', 'Bouncy',
    'Fuzzy', 'Jolly', 'Peppy', 'Wiggly', 'Cuddly',
    'Bubbly', 'Chirpy', 'Dreamy', 'Giggly', 'Happy',
    'Merry', 'Perky', 'Silly', 'Sunny', 'Zippy',
    'Cheery', 'Dainty', 'Gentle', 'Peachy', 'Sassy',
    'Sprightly', 'Twinkly', 'Whimsy', 'Zesty', 'Breezy'
];

// Friendly, recognizable animals
const ANIMALS = [
    'Panda', 'Otter', 'Koala', 'Penguin', 'Bunny',
    'Dolphin', 'Owl', 'Fox', 'Bear', 'Deer',
    'Hedgehog', 'Hamster', 'Kitten', 'Puppy', 'Squirrel',
    'Raccoon', 'Sloth', 'Seal', 'Duckling', 'Fawn',
    'Lemur', 'Alpaca', 'Capybara', 'Quokka', 'Meerkat',
    'Chinchilla', 'Ferret', 'Beaver', 'Badger', 'Wombat'
];

/**
 * Generate a deterministic anonymous display name from a deviceId.
 * Same deviceId always produces the same name.
 * 
 * @param deviceId - The device fingerprint ID
 * @returns A human-readable name like "FluffyPanda3A8B72"
 */
export function generateAnonymousName(deviceId: string): string {
    if (!deviceId) {
        return 'AnonymousUser';
    }

    const hash = createHash('sha256').update(deviceId).digest('hex');

    // Use different parts of the hash for adjective, animal, and suffix
    const adjIndex = parseInt(hash.slice(0, 4), 16) % ADJECTIVES.length;
    const animalIndex = parseInt(hash.slice(4, 8), 16) % ANIMALS.length;
    const suffix = hash.slice(8, 14).toUpperCase();

    return `${ADJECTIVES[adjIndex]}${ANIMALS[animalIndex]}${suffix}`;
}

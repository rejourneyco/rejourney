import Constants from 'expo-constants';
import { Env } from '@/types';

const config = {
  env: Constants.expoConfig?.extra?.env as Env,
  apiUrl: Constants.expoConfig?.extra?.apiUrl as string,
  rejourneyPublicKey:
    (Constants.expoConfig?.extra as { rejourneyPublicKey?: string })?.rejourneyPublicKey ?? '',
  rejourneyApiUrl:
    (Constants.expoConfig?.extra as { rejourneyApiUrl?: string })?.rejourneyApiUrl ??
    'https://api.rejourney.co',
  mapboxAccessToken: (Constants.expoConfig?.extra as { mapboxAccessToken?: string })?.mapboxAccessToken ?? '',
} as const satisfies {
  env: Env;
  apiUrl: string;
  rejourneyPublicKey: string;
  rejourneyApiUrl: string;
  mapboxAccessToken: string;
};

export default config;

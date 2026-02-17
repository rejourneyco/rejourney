import Constants from 'expo-constants';
import { Env } from '@/types';

const config = {
  env: Constants.expoConfig?.extra?.env as Env,
  apiUrl: Constants.expoConfig?.extra?.apiUrl as string,
  mapboxAccessToken: (Constants.expoConfig?.extra as { mapboxAccessToken?: string })?.mapboxAccessToken ?? '',
} as const satisfies {
  env: Env;
  apiUrl: string;
  mapboxAccessToken: string;
};

export default config;

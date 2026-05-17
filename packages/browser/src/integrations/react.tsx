import { createContext, createElement, useContext, useEffect, type PropsWithChildren } from 'react';
import { Rejourney, initRejourney, startRejourney, stopRejourney } from '../sdk/client.js';
import type { RejourneyAPI, RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyProviderProps extends PropsWithChildren {
  publicKey: string;
  startOnMount?: boolean;
  options?: RejourneyWebConfig;
}

const RejourneyContext = createContext<RejourneyAPI>(Rejourney);

export function RejourneyProvider({
  publicKey,
  startOnMount = false,
  options,
  children,
}: RejourneyProviderProps) {
  useEffect(() => {
    let cancelled = false;
    void initRejourney(publicKey, options).then(() => {
      if (!cancelled && startOnMount) void startRejourney();
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, startOnMount, options]);

  return createElement(RejourneyContext.Provider, { value: Rejourney }, children);
}

export function useRejourney(): RejourneyAPI {
  return useContext(RejourneyContext);
}

export { Rejourney, initRejourney, startRejourney, stopRejourney };

import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { useDemoMode } from './DemoModeContext';

const STORAGE_PREFIX = 'rejourney.dashboard.workspaceTabs';
const CHANGE_EVENT = 'rejourney:dashboard-preferences';
const memoryPreferences = new Map<string, boolean>();

// Preferences are personal and browser-local; a saved workspace never opts a
// user into tabs. Demo preferences are kept separate from signed-in accounts.
export function useDashboardPreferences() {
    const { user } = useAuth();
    const { isDemoMode } = useDemoMode();
    const storageKey = `${STORAGE_PREFIX}:${isDemoMode ? 'demo' : user?.id ?? 'guest'}`;

    const getSnapshot = useCallback(() => {
        if (memoryPreferences.has(storageKey)) return memoryPreferences.get(storageKey)!;
        try {
            return window.localStorage.getItem(storageKey) === 'true';
        } catch {
            return memoryPreferences.get(storageKey) ?? false;
        }
    }, [storageKey]);

    const subscribe = useCallback((onChange: () => void) => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key === storageKey || event.key === null) {
                memoryPreferences.delete(storageKey);
                onChange();
            }
        };
        window.addEventListener('storage', handleStorage);
        window.addEventListener(CHANGE_EVENT, onChange);
        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener(CHANGE_EVENT, onChange);
        };
    }, [storageKey]);

    const workspaceTabsEnabled = useSyncExternalStore(subscribe, getSnapshot, () => false);
    const setWorkspaceTabsEnabled = useCallback((enabled: boolean) => {
        memoryPreferences.set(storageKey, enabled);
        try {
            window.localStorage.setItem(storageKey, String(enabled));
        } catch {
            // Keep the preference usable for this visit when storage is blocked.
        }
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }, [storageKey]);

    return { workspaceTabsEnabled, setWorkspaceTabsEnabled };
}

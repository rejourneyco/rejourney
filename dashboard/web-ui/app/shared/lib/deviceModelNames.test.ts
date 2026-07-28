import { describe, expect, it } from 'vitest';
import {
    formatDeviceModel,
    getDeviceModelSearchText,
    normalizeAndroidDeviceModelIdentifier,
} from './deviceModelNames';

describe('formatDeviceModel', () => {
    it('formats Android model identifiers using their marketing names', () => {
        expect(formatDeviceModel('SM-A217F')).toBe('Galaxy A21s');
        expect(formatDeviceModel('25113PN0EG')).toBe('Xiaomi 17');
        expect(formatDeviceModel('sm-a217f')).toBe('Galaxy A21s');
    });

    it('recognizes common Android emulator model identifiers', () => {
        expect(formatDeviceModel('sdk_gphone16k_arm64')).toBe('Android Emulator');
        expect(formatDeviceModel('sdk_gphone64_arm64')).toBe('Android Emulator');
        expect(formatDeviceModel('sdk_gphone64_x86_64')).toBe('Android Emulator');
        expect(formatDeviceModel('Android SDK built for x86_64')).toBe('Android Emulator');
    });

    it('preserves existing Apple mappings and unknown real-device identifiers', () => {
        expect(formatDeviceModel('iPhone15,3')).toBe('iPhone 14 Pro Max');
        expect(formatDeviceModel('FuturePhone-123')).toBe('FuturePhone-123');
        expect(formatDeviceModel('Unknown Device')).toBe('Unknown Device');
    });

    it('normalizes Android lookup keys and keeps raw identifiers searchable', () => {
        expect(normalizeAndroidDeviceModelIdentifier('  SM-A217F  ')).toBe('sm-a217f');
        expect(getDeviceModelSearchText('SM-A217F')).toBe('sm-a217f galaxy a21s');
    });
});

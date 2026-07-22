import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from '../validation/projects.js';

describe('Project Validation', () => {
    describe('App Identifier Validation (bundleId / packageName)', () => {
        const validIosBundleIds = [
            'com.apple.mobilemail',
            'com.example.app',
            'com.my-company.my-app',
            'com.company.app123',
            'com.companyname.appname',
            'com.apple.Maps',
            'com.apple.mobilesafari',
            'com.okbx.fax-sender.dev',
            'com.okbx.fax-sender.staging',
            'a.b', // 3 chars, has period
            '1com.example.app', // Number start (valid for iOS)
            'com.-example.app', // Hyphen start in segment (valid for iOS)
            'com.company.app.bundle.id.with.lots.of.segments'
        ];

        const validAndroidPackageNames = [
            'com.example.myapp',
            'com.mycompany.product.feature',
            'org.foundation.utilityapp',
            'net.developers.game_title',
            'ir.example.flashlight',
            'com.techbros.auth',
            'com.github.username.projectname',
            'com.okbx.faxsender.dev',
            'ir.android_example.flashlight',
            'int_.example.app' // using underscore for reserved words
        ];

        const invalidIdentifiers = [
            'com', // no period
            'co', // too short, no period
            'com..example.app', // consecutive periods
            '.com.example.app', // starts with period
            'com.example.app.', // ends with period
            'com.example@app', // invalid char @
            'com.example app', // invalid char space
            'com.example!app', // invalid char !
            'com.example.#app', // invalid char #
            'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.A.B.C.D.E.F.G.H.I.J.K.L.M.N.O.P.Q.R.S.T.U.V.W.X.Y.Z.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.A.B.C.D.E.F.G.H.I.J.K.L.M.N.O.P.Q.R.S.T.U.V.W.X.Y.Z.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z', // > 155 chars
        ];

        it('should accept valid iOS bundle IDs', () => {
            validIosBundleIds.forEach((bundleId) => {
                const result = createProjectSchema.safeParse({ name: 'Test', bundleId });
                expect(result.success).toBe(true);
            });
        });

        it('should accept valid Android package names', () => {
            validAndroidPackageNames.forEach((packageName) => {
                const result = createProjectSchema.safeParse({ name: 'Test', packageName });
                expect(result.success).toBe(true);
            });
        });

        it('should reject invalid identifiers for bundleId', () => {
            invalidIdentifiers.forEach((bundleId) => {
                const result = createProjectSchema.safeParse({ name: 'Test', bundleId });
                expect(result.success).toBe(false);
            });
        });

        it('should reject invalid identifiers for packageName', () => {
            invalidIdentifiers.forEach((packageName) => {
                const result = createProjectSchema.safeParse({ name: 'Test', packageName });
                expect(result.success).toBe(false);
            });
        });
    });

    describe('Text input masking', () => {
        it('defaults new projects to masking all text inputs', () => {
            const result = createProjectSchema.parse({ name: 'Test' });
            expect(result.textInputMasking).toBe('all');
        });

        it('accepts secure-only masking for project create and update', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', textInputMasking: 'secure_only' }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ textInputMasking: 'secure_only' }).success).toBe(true);
        });

        it('rejects unknown text masking values', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', textInputMasking: 'none' }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ textInputMasking: 'none' }).success).toBe(false);
        });
    });

    describe('Image and video masking', () => {
        it('defaults new projects to not masking images and videos', () => {
            const result = createProjectSchema.parse({ name: 'Test' });
            expect(result.imageVideoMasking).toBe('none');
        });

        it('accepts all-media masking for project create and update', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', imageVideoMasking: 'all' }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ imageVideoMasking: 'all' }).success).toBe(true);
        });

        it('rejects unknown image and video masking values', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', imageVideoMasking: 'secure_only' }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ imageVideoMasking: 'secure_only' }).success).toBe(false);
        });
    });

    describe('Recording FPS', () => {
        it('defaults new projects to 1 FPS', () => {
            const result = createProjectSchema.parse({ name: 'Test' });
            expect(result.recordingFps).toBe(1);
        });

        it('accepts 1-3 FPS for project create and update', () => {
            [1, 2, 3].forEach((recordingFps) => {
                expect(createProjectSchema.safeParse({ name: 'Test', recordingFps }).success).toBe(true);
                expect(updateProjectSchema.safeParse({ recordingFps }).success).toBe(true);
            });
        });

        it('rejects FPS values outside the remote range', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', recordingFps: 0 }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ recordingFps: 4 }).success).toBe(false);
        });
    });

    describe('Sample rate', () => {
        it('defaults new projects to 100 percent sampling', () => {
            const result = createProjectSchema.parse({ name: 'Test' });
            expect(result.sampleRate).toBe(100);
        });

        it('accepts 0-100 percent sample rates for project create and update', () => {
            [0, 50, 100].forEach((sampleRate) => {
                expect(createProjectSchema.safeParse({ name: 'Test', sampleRate }).success).toBe(true);
                expect(updateProjectSchema.safeParse({ sampleRate }).success).toBe(true);
            });
        });

        it('rejects sample rates outside the remote range', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', sampleRate: -1 }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ sampleRate: 101 }).success).toBe(false);
        });
    });

    describe('Observability duration', () => {
        it('defaults mobile duration to 10 minutes and web duration to 30 minutes', () => {
            const result = createProjectSchema.parse({ name: 'Test' });
            expect(result.maxRecordingMinutes).toBe(10);
            expect(result.webMaxObservabilityMinutes).toBe(30);
        });

        it('accepts 1-10 minute mobile and 1-30 minute web durations for project create and update', () => {
            [1, 5, 10].forEach((minutes) => {
                expect(createProjectSchema.safeParse({ name: 'Test', maxRecordingMinutes: minutes }).success).toBe(true);
                expect(updateProjectSchema.safeParse({ maxRecordingMinutes: minutes }).success).toBe(true);
                expect(createProjectSchema.safeParse({ name: 'Test', webMaxObservabilityMinutes: minutes }).success).toBe(true);
                expect(updateProjectSchema.safeParse({ webMaxObservabilityMinutes: minutes }).success).toBe(true);
            });
            [15, 30].forEach((minutes) => {
                expect(createProjectSchema.safeParse({ name: 'Test', webMaxObservabilityMinutes: minutes }).success).toBe(true);
                expect(updateProjectSchema.safeParse({ webMaxObservabilityMinutes: minutes }).success).toBe(true);
            });
        });

        it('rejects mobile and web durations outside their remote ranges', () => {
            expect(createProjectSchema.safeParse({ name: 'Test', maxRecordingMinutes: 0 }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ maxRecordingMinutes: 11 }).success).toBe(false);
            expect(createProjectSchema.safeParse({ name: 'Test', webMaxObservabilityMinutes: 0 }).success).toBe(false);
            expect(updateProjectSchema.safeParse({ webMaxObservabilityMinutes: 31 }).success).toBe(false);
        });
    });

    describe('Web allowed domains', () => {
        it('normalizes allowed domains for web project creation', () => {
            const result = createProjectSchema.parse({
                name: 'Web App',
                platforms: ['web'],
                webAllowedDomains: ['https://App.Example.com/path', '*.shop.example.com', 'localhost:3000'],
            });

            expect(result.webAllowedDomains).toEqual(['app.example.com', '*.shop.example.com', 'localhost:3000']);
            expect(result.webDomain).toBeUndefined();
        });

        it('requires an allowed domain when web is selected', () => {
            const result = createProjectSchema.safeParse({
                name: 'Web App',
                platforms: ['web'],
                webAllowedDomains: [],
            });

            expect(result.success).toBe(false);
        });

        it('accepts the legacy webDomain field as the first web allowed domain', () => {
            const result = createProjectSchema.parse({
                name: 'Web App',
                platforms: ['web'],
                webDomain: 'https://www.example.com/docs',
            });

            expect(result.webDomain).toBe('www.example.com');
        });

        it('accepts clearing web domains on project update', () => {
            expect(updateProjectSchema.safeParse({ webAllowedDomains: [] }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ webDomain: null }).success).toBe(true);
        });

        it('accepts clearing app identifiers on project update', () => {
            expect(updateProjectSchema.safeParse({ bundleId: null }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ packageName: null }).success).toBe(true);
        });

        it('accepts platforms array on project update', () => {
            expect(updateProjectSchema.safeParse({ platforms: ['ios', 'web'] }).success).toBe(true);
        });
    });

    describe('Supported project integrations', () => {
        it('rejects Native Android as a standalone integration', () => {
            const created = createProjectSchema.safeParse({
                name: 'Android App',
                platforms: ['android'],
                packageName: 'com.example.app',
            });
            const updated = updateProjectSchema.safeParse({ platforms: ['android'] });

            expect(created.success).toBe(false);
            expect(updated.success).toBe(false);
            if (!created.success) {
                expect(created.error.issues[0]?.message).toContain('Android is supported through React Native or Flutter');
            }
        });

        it('accepts Android runtime markers when React Native is selected', () => {
            expect(createProjectSchema.safeParse({
                name: 'React Native App',
                platforms: ['react-native', 'android'],
                packageName: 'com.example.app',
            }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ platforms: ['react-native', 'android'] }).success).toBe(true);
        });

        it('accepts Flutter projects and Android runtime markers', () => {
            expect(createProjectSchema.safeParse({
                name: 'Flutter App',
                platforms: ['flutter', 'android'],
                packageName: 'com.example.flutter_app',
            }).success).toBe(true);
            expect(updateProjectSchema.safeParse({ platforms: ['flutter', 'android'] }).success).toBe(true);
        });
    });
});

import { describe, expect, it } from 'vitest';
import { createProjectSchema } from '../validation/projects.js';

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
});

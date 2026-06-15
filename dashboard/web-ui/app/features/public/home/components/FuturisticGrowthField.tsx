import React, { useEffect, useRef } from 'react';
import type { BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D, SpriteMaterial } from 'three';

type GrowthFieldVariant = 'hero' | 'sparse';

type FuturisticGrowthFieldProps = {
    className?: string;
    seed?: number;
    variant?: GrowthFieldVariant;
};

type ParticleState = {
    x: number;
    y: number;
    z: number;
    drift: number;
    phase: number;
    speed: number;
};

type RibbonState = {
    mesh: Object3D;
    material: MeshBasicMaterial;
    baseOpacity: number;
    phase: number;
    speed: number;
};

type HealingStrandState = {
    mesh: Mesh;
    material: MeshBasicMaterial;
    baseOpacity: number;
    phase: number;
    speed: number;
};

type RepairNodeState = {
    group: Group;
    ring: Mesh;
    ringMaterial: MeshBasicMaterial;
    coreMaterial: MeshBasicMaterial;
    glowMaterial: SpriteMaterial;
    baseScale: number;
    baseY: number;
    phase: number;
    spin: number;
};

type SatelliteState = {
    mesh: Mesh;
    orbitRadius: number;
    orbitSpeed: number;
    angle: number;
    orbitGroup: Group;
};

const createSeededRandom = (seed: number) => {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;

    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
};

export const FuturisticGrowthField: React.FC<FuturisticGrowthFieldProps> = ({
    className = '',
    seed = 17,
    variant = 'sparse',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined' || !canvasRef.current) return;

        let frameId = 0;
        let disposed = false;
        let isVisible = true;
        let resizeObserver: ResizeObserver | null = null;
        let visibilityObserver: IntersectionObserver | null = null;
        let teardownScene: (() => void) | null = null;
        const canvas = canvasRef.current;
        const container = canvas.parentElement;

        if (!container) return;

        const bootScene = async () => {
            const THREE = await import('three');

            if (disposed || !canvasRef.current) return;

            const isHero = variant === 'hero';
            const random = createSeededRandom(seed);
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setClearAlpha(0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isHero ? 1.5 : 1.0));
            renderer.outputColorSpace = THREE.SRGBColorSpace;

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(isHero ? 36 : 42, 1, 0.1, 100);
            camera.position.set(0, 0.15, isHero ? 8.25 : 7.1);

            const disposables: Array<{ dispose: () => void }> = [];
            const register = <T extends { dispose: () => void }>(item: T) => {
                disposables.push(item);
                return item;
            };

            const createSquareTexture = () => {
                const sprite = document.createElement('canvas');
                sprite.width = 32;
                sprite.height = 32;
                const ctx = sprite.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, 32, 32);
                    ctx.fillStyle = 'rgba(255,255,255,.95)';
                    ctx.fillRect(10, 10, 12, 12);
                    ctx.fillStyle = 'rgba(255,255,255,.26)';
                    ctx.fillRect(7, 7, 18, 18);
                }

                const texture = new THREE.CanvasTexture(sprite);
                texture.needsUpdate = true;
                return register(texture);
            };

            const createCircleTexture = () => {
                const sprite = document.createElement('canvas');
                sprite.width = 64;
                sprite.height = 64;
                const ctx = sprite.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, 64, 64);
                    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
                    gradient.addColorStop(0, 'rgba(255,255,255,1)');
                    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
                    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
                    gradient.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, 64, 64);
                }
                const texture = new THREE.CanvasTexture(sprite);
                texture.needsUpdate = true;
                return register(texture);
            };

            const squareTexture = createSquareTexture();
            const circleTexture = createCircleTexture();

            scene.add(new THREE.AmbientLight(0xecfbff, isHero ? 1.7 : 1.1));

            const keyLight = new THREE.DirectionalLight(0xffffff, isHero ? 2.25 : 1.35);
            keyLight.position.set(-3.4, 5.5, 4.8);
            scene.add(keyLight);

            const cyanLight = new THREE.PointLight(0x38bdf8, isHero ? 6.5 : 3.2, 14);
            cyanLight.position.set(-3.1, -0.8, 2.6);
            scene.add(cyanLight);

            const lavenderLight = new THREE.PointLight(0xa78bfa, isHero ? 5.4 : 2.4, 13);
            lavenderLight.position.set(3.6, 1.0, 2.2);
            scene.add(lavenderLight);

            const root = new THREE.Group();
            root.position.set(0, isHero ? -0.12 : -0.15, 0);
            root.rotation.x = isHero ? -0.07 : -0.05;
            scene.add(root);

            const starsGroup = new THREE.Group();
            const ribbonsGroup = new THREE.Group();
            const planetGroup = new THREE.Group();
            const satelliteGroup = new THREE.Group();
            const repairGroup = new THREE.Group();
            root.add(starsGroup, ribbonsGroup, planetGroup, satelliteGroup, repairGroup);

            const starCount = isHero ? 560 : 120;
            const starPositions = new Float32Array(starCount * 3);
            const starColors = new Float32Array(starCount * 3);
            const starSizes = new Float32Array(starCount);
            const starStates: ParticleState[] = [];
            const starPalette = [0x60a5fa, 0x38bdf8, 0x8b5cf6, 0xf9a8d4, 0x93c5fd, 0xffffff];

            for (let i = 0; i < starCount; i++) {
                let x = (random() - 0.5) * (isHero ? 15.0 : 10.0);
                let y = (random() - 0.5) * (isHero ? 8.0 : 5.0);
                const z = -3.4 - random() * 6.0;

                const color = new THREE.Color(starPalette[Math.floor(random() * starPalette.length)]);
                const brightness = 0.3 + random() * 0.7;

                starPositions[i * 3] = x;
                starPositions[i * 3 + 1] = y;
                starPositions[i * 3 + 2] = z;
                starColors[i * 3] = color.r * brightness;
                starColors[i * 3 + 1] = color.g * brightness;
                starColors[i * 3 + 2] = color.b * brightness;
                starSizes[i] = random() * (isHero ? 0.08 : 0.05) + 0.02;

                starStates.push({
                    x,
                    y,
                    z,
                    drift: 0.01 + random() * 0.06,
                    phase: random() * Math.PI * 2,
                    speed: 0.05 + random() * 0.2,
                });
            }

            const starGeometry = register(new THREE.BufferGeometry());
            starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
            starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
            starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

            const starMaterial = register(new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: circleTexture },
                    opacity: { value: isHero ? 0.55 : 0.35 },
                },
                vertexShader: `
                    attribute float size;
                    attribute vec3 color;
                    varying vec3 vColor;
                    void main() {
                        vColor = color;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (300.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D map;
                    uniform float opacity;
                    varying vec3 vColor;
                    void main() {
                        vec4 texColor = texture2D(map, gl_PointCoord);
                        gl_FragColor = vec4(vColor, opacity) * texColor;
                    }
                `,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
            }));

            const stars = new THREE.Points(starGeometry, starMaterial);
            starsGroup.add(stars);

            let planetShell: Mesh | null = null;
            let planetGlow: Mesh | null = null;
            let planetWire: Mesh | null = null;
            const latitudeRings: Mesh[] = [];
            const ribbons: RibbonState[] = [];
            const healingStrands: HealingStrandState[] = [];
            const repairNodes: RepairNodeState[] = [];
            const satellites: SatelliteState[] = [];

            if (isHero) {
                planetGroup.position.set(0, -2.25, -0.45);
                planetGroup.scale.set(1.72, 0.78, 1.72);

                planetShell = new THREE.Mesh(
                    register(new THREE.SphereGeometry(1.34, 72, 36)),
                    register(new THREE.MeshPhysicalMaterial({
                        color: 0xe7f8ff,
                        roughness: 0.4,
                        metalness: 0.02,
                        clearcoat: 0.7,
                        clearcoatRoughness: 0.18,
                        transparent: true,
                        opacity: 0.5,
                        depthWrite: false,
                    }))
                );
                planetGroup.add(planetShell);

                planetGlow = new THREE.Mesh(
                    register(new THREE.SphereGeometry(1.41, 56, 28)),
                    register(new THREE.MeshBasicMaterial({
                        color: 0xe0f2fe,
                        transparent: true,
                        opacity: 0.3,
                        blending: THREE.NormalBlending,
                        depthWrite: false,
                    }))
                );
                planetGroup.add(planetGlow);

                planetWire = new THREE.Mesh(
                    register(new THREE.IcosahedronGeometry(1.43, 4)),
                    register(new THREE.MeshBasicMaterial({
                        color: 0x93c5fd,
                        wireframe: true,
                        transparent: true,
                        opacity: 0.25,
                        blending: THREE.NormalBlending,
                        depthWrite: false,
                    }))
                );
                planetGroup.add(planetWire);

                const latitudeMaterial = register(new THREE.MeshBasicMaterial({
                    color: 0xbfdbfe,
                    transparent: true,
                    opacity: 0.3,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                }));

                for (let i = 0; i < 5; i++) {
                    const radius = 1.22 - i * 0.16;
                    const ring = new THREE.Mesh(
                        register(new THREE.TorusGeometry(radius, 0.005, 4, 96)),
                        latitudeMaterial
                    );
                    ring.position.y = -0.18 + i * 0.15;
                    ring.rotation.x = Math.PI / 2;
                    ring.scale.y = 0.2 + i * 0.05;
                    planetGroup.add(ring);
                    latitudeRings.push(ring);
                }

                ribbonsGroup.position.set(0, -1.26, 0.15);

                const addRibbonWithSatellites = (
                    radius: number,
                    tube: number,
                    color: number,
                    opacity: number,
                    rotation: [number, number, number],
                    scale: [number, number, number],
                    speed: number,
                    phase: number,
                    numSatellites: number
                ) => {
                    const orbitGroup = new THREE.Group();
                    orbitGroup.rotation.set(rotation[0], rotation[1], rotation[2]);
                    orbitGroup.scale.set(scale[0], scale[1], scale[2]);
                    
                    const mesh = new THREE.Mesh(
                        register(new THREE.TorusGeometry(radius, tube, 16, 200)),
                        register(new THREE.MeshBasicMaterial({
                            color,
                            transparent: true,
                            opacity,
                            blending: THREE.NormalBlending,
                            depthWrite: false,
                        }))
                    );
                    orbitGroup.add(mesh);
                    ribbonsGroup.add(orbitGroup);
                    
                    ribbons.push({
                        mesh: orbitGroup,
                        material: mesh.material as MeshBasicMaterial,
                        baseOpacity: opacity,
                        phase,
                        speed,
                    });

                    for (let s = 0; s < numSatellites; s++) {
                        const satMesh = new THREE.Mesh(
                            register(new THREE.SphereGeometry(tube * 6, 16, 16)),
                            register(new THREE.MeshBasicMaterial({
                                color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
                                transparent: true,
                                opacity: 0.9,
                                blending: THREE.AdditiveBlending,
                                depthWrite: false,
                            }))
                        );
                        const glowMaterial = register(new THREE.SpriteMaterial({
                            map: circleTexture,
                            color: color,
                            transparent: true,
                            opacity: 0.8,
                            blending: THREE.AdditiveBlending,
                            depthWrite: false,
                        }));
                        const sprite = new THREE.Sprite(glowMaterial);
                        sprite.scale.set(tube * 40, tube * 40, 1);
                        satMesh.add(sprite);

                        orbitGroup.add(satMesh);
                        satellites.push({
                            mesh: satMesh,
                            orbitRadius: radius,
                            orbitSpeed: speed * (1.5 + random()),
                            angle: (Math.PI * 2 / numSatellites) * s + random(),
                            orbitGroup: orbitGroup,
                        });
                    }
                };

                addRibbonWithSatellites(
                    4.5, 0.012, 0x7dd3fc, 0.25,
                    [Math.PI / 2.2, 0.08, -0.08], [1.18, 0.33, 1],
                    0.15, 0.1, 2
                );
                addRibbonWithSatellites(
                    5.2, 0.01, 0xa78bfa, 0.2,
                    [Math.PI / 2.06, -0.04, 0.06], [1.02, 0.52, 1],
                    -0.1, 1.7, 3
                );
                addRibbonWithSatellites(
                    3.8, 0.015, 0xf0a4cf, 0.25,
                    [Math.PI / 2.35, 0.34, 0.75], [1.14, 0.36, 1],
                    0.2, 2.8, 2
                );

                const addHealingStrand = (
                    points: Array<[number, number, number]>,
                    color: number,
                    opacity: number,
                    tube: number,
                    speed: number,
                    phase: number
                ) => {
                    const curve = new THREE.CatmullRomCurve3(
                        points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
                    );
                    const material = register(new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));
                    const mesh = new THREE.Mesh(
                        register(new THREE.TubeGeometry(curve, 180, tube, 8, false)),
                        material
                    );
                    repairGroup.add(mesh);
                    healingStrands.push({ mesh, material, baseOpacity: opacity, phase, speed });
                };

                addHealingStrand(
                    [[-5.35, 1.06, -0.95], [-2.4, 1.62, -1.18], [0, 1.46, -1.05], [2.5, 1.68, -1.18], [5.35, 1.08, -0.95]],
                    0x7dd3fc,
                    0.22,
                    0.008,
                    0.12,
                    0.1
                );
                addHealingStrand(
                    [[-5.05, -1.05, -0.78], [-2.35, -1.48, -1.04], [0, -1.24, -0.96], [2.35, -1.48, -1.04], [5.05, -1.02, -0.78]],
                    0xa78bfa,
                    0.18,
                    0.007,
                    -0.1,
                    1.8
                );
                addHealingStrand(
                    [[-4.85, 0.24, -1.1], [-2.15, 0.58, -1.26], [0.2, 0.42, -1.18], [2.45, 0.62, -1.26], [4.85, 0.22, -1.1]],
                    0x34d399,
                    0.13,
                    0.006,
                    0.08,
                    2.7
                );

                const addRepairNode = (
                    x: number,
                    y: number,
                    z: number,
                    color: number,
                    baseScale: number,
                    phase: number
                ) => {
                    const group = new THREE.Group();
                    group.position.set(x, y, z);
                    group.scale.setScalar(baseScale);

                    const ringMaterial = register(new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity: 0.42,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));
                    const ring = new THREE.Mesh(
                        register(new THREE.TorusGeometry(0.23, 0.008, 10, 96)),
                        ringMaterial
                    );

                    const coreMaterial = register(new THREE.MeshBasicMaterial({
                        color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.42),
                        transparent: true,
                        opacity: 0.72,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));
                    const core = new THREE.Mesh(
                        register(new THREE.SphereGeometry(0.045, 18, 18)),
                        coreMaterial
                    );

                    const glowMaterial = register(new THREE.SpriteMaterial({
                        map: circleTexture,
                        color,
                        transparent: true,
                        opacity: 0.38,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));
                    const glow = new THREE.Sprite(glowMaterial);
                    glow.scale.set(0.72, 0.72, 1);

                    group.add(glow, ring, core);
                    repairGroup.add(group);
                    repairNodes.push({
                        group,
                        ring,
                        ringMaterial,
                        coreMaterial,
                        glowMaterial,
                        baseScale,
                        baseY: y,
                        phase,
                        spin: 0.16 + random() * 0.18,
                    });
                };

                addRepairNode(-4.55, 1.25, -0.58, 0x38bdf8, 1.08, 0.2);
                addRepairNode(4.62, 1.18, -0.62, 0xa78bfa, 1.0, 1.4);
                addRepairNode(-4.18, -0.92, -0.38, 0x34d399, 0.86, 2.5);
                addRepairNode(4.22, -1.08, -0.42, 0xf9a8d4, 0.92, 3.1);
                addRepairNode(0.08, 1.96, -0.82, 0x7dd3fc, 0.74, 4.2);
            }

            const sparkCount = isHero ? 120 : 30;
            const sparkPositions = new Float32Array(sparkCount * 3);
            const sparkColors = new Float32Array(sparkCount * 3);
            const sparks: ParticleState[] = [];
            const sparkPalette = [new THREE.Color(0x38bdf8), new THREE.Color(0xa78bfa), new THREE.Color(0xf9a8d4), new THREE.Color(0x34d399)];

            for (let i = 0; i < sparkCount; i++) {
                const band = random();
                const x = (random() - 0.5) * (isHero ? 8.0 : 6.0);
                const y = band > 0.38 ? -0.2 + random() * 2.0 : -2.0 + random() * 1.5;
                const z = -1.2 + (random() - 0.5) * 2.0;
                sparks.push({
                    x,
                    y,
                    z,
                    drift: 0.03 + random() * 0.08,
                    phase: random() * Math.PI * 2,
                    speed: 0.15 + random() * 0.25,
                });
                sparkPositions[i * 3] = x;
                sparkPositions[i * 3 + 1] = y;
                sparkPositions[i * 3 + 2] = z;

                const color = sparkPalette[Math.floor(random() * sparkPalette.length)];
                sparkColors[i * 3] = color.r;
                sparkColors[i * 3 + 1] = color.g;
                sparkColors[i * 3 + 2] = color.b;
            }

            const sparkGeometry = register(new THREE.BufferGeometry());
            sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
            sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

            const sparkMaterial = register(new THREE.PointsMaterial({
                map: squareTexture,
                size: isHero ? 0.085 : 0.05,
                sizeAttenuation: true,
                vertexColors: true,
                transparent: true,
                opacity: isHero ? 0.6 : 0.4,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const sparkField = new THREE.Points(sparkGeometry, sparkMaterial);
            root.add(sparkField);

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.position.z = isHero ? (width < 640 ? 9.35 : 8.25) : 7.1;
                camera.updateProjectionMatrix();
                const scale = isHero ? (width < 640 ? 0.86 : 1) : 0.9;
                root.scale.setScalar(scale);
            };

            resize();
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);

            let sceneDisposed = false;
            teardownScene = () => {
                if (sceneDisposed) return;
                sceneDisposed = true;
                if (frameId) window.cancelAnimationFrame(frameId);
                resizeObserver?.disconnect();
                visibilityObserver?.disconnect();
                disposables.forEach((disposable) => disposable.dispose());
                renderer.dispose();
            };

            const clock = new THREE.Clock();
            let lastTime = 0;

            const renderFrame = () => {
                frameId = 0;
                const elapsed = reducedMotion ? 2.2 : clock.getElapsedTime();
                const totalTime = clock.getElapsedTime();
                const dt = Math.min(0.034, totalTime - lastTime);
                lastTime = totalTime;

                root.rotation.y = Math.sin(elapsed * 0.08) * 0.025;
                starsGroup.rotation.y = elapsed * 0.01;

                if (planetShell && planetGlow && planetWire) {
                    planetShell.rotation.y = elapsed * 0.08;
                    planetGlow.rotation.y = elapsed * 0.05;
                    planetWire.rotation.y = -elapsed * 0.1;
                }
                
                latitudeRings.forEach((ring, index) => {
                    ring.rotation.z = elapsed * (0.05 + index * 0.01);
                });

                ribbons.forEach((ribbon) => {
                    ribbon.mesh.rotation.z += reducedMotion ? 0 : ribbon.speed * dt;
                    ribbon.mesh.rotation.y += reducedMotion ? 0 : ribbon.speed * 0.2 * dt;
                    ribbon.material.opacity = ribbon.baseOpacity + Math.sin(elapsed * 0.8 + ribbon.phase) * ribbon.baseOpacity * 0.15;
                });

                healingStrands.forEach((strand, index) => {
                    strand.material.opacity = strand.baseOpacity + Math.sin(elapsed * 1.05 + strand.phase) * strand.baseOpacity * 0.34;
                    strand.mesh.rotation.z = Math.sin(elapsed * 0.16 + strand.phase) * 0.014;
                    strand.mesh.position.y = Math.sin(elapsed * 0.42 + strand.phase + index) * 0.035;
                });

                repairNodes.forEach((node) => {
                    const pulse = Math.sin(elapsed * 1.7 + node.phase);
                    const scale = node.baseScale * (1 + pulse * 0.08);
                    node.group.scale.setScalar(scale);
                    node.group.position.y = node.baseY + Math.sin(elapsed * 0.64 + node.phase) * 0.05;
                    node.ring.rotation.z += reducedMotion ? 0 : node.spin * dt;
                    node.ring.rotation.x = Math.sin(elapsed * 0.36 + node.phase) * 0.22;
                    node.ringMaterial.opacity = 0.32 + Math.max(0, pulse) * 0.28;
                    node.coreMaterial.opacity = 0.52 + Math.max(0, pulse) * 0.24;
                    node.glowMaterial.opacity = 0.22 + Math.max(0, pulse) * 0.28;
                });

                satellites.forEach((sat) => {
                    if (!reducedMotion) {
                        sat.angle += sat.orbitSpeed * dt;
                    }
                    sat.mesh.position.x = Math.cos(sat.angle) * sat.orbitRadius;
                    sat.mesh.position.y = Math.sin(sat.angle) * sat.orbitRadius;
                });

                const starPosAttr = starGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < starCount; i++) {
                    const star = starStates[i];
                    const drift = Math.sin(elapsed * star.speed + star.phase) * star.drift;
                    starPosAttr.setXYZ(i, star.x + drift, star.y - drift * 0.5, star.z);
                }
                starPosAttr.needsUpdate = true;

                const sparkPosAttr = sparkGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < sparkCount; i++) {
                    const spark = sparks[i];
                    spark.y += reducedMotion ? 0 : spark.speed * dt;
                    if (spark.y > (isHero ? 2.5 : 1.5)) {
                        spark.y = (isHero ? -2.5 : -1.5) + random() * 0.5;
                        spark.x = (random() - 0.5) * (isHero ? 8.0 : 6.0);
                    }
                    const wobble = Math.sin(elapsed * 1.5 + spark.phase) * spark.drift;
                    sparkPosAttr.setXYZ(i, spark.x + wobble, spark.y, spark.z);
                }
                sparkPosAttr.needsUpdate = true;

                renderer.render(scene, camera);

                if (!reducedMotion && !disposed && isVisible) {
                    frameId = window.requestAnimationFrame(renderFrame);
                }
            };

            visibilityObserver = new IntersectionObserver(([entry]) => {
                isVisible = entry?.isIntersecting ?? true;
                if (isVisible && !frameId && !reducedMotion && !disposed) {
                    frameId = window.requestAnimationFrame(renderFrame);
                } else if (!isVisible && frameId) {
                    window.cancelAnimationFrame(frameId);
                    frameId = 0;
                }
            }, { threshold: 0.01 });
            visibilityObserver.observe(container);

            renderFrame();
        };

        bootScene().catch(() => {
            canvas.style.opacity = '0';
        });

        return () => {
            disposed = true;
            teardownScene?.();
        };
    }, [seed, variant]);

    const canvasStyle: React.CSSProperties = {
        height: variant === 'hero' ? 'max(132%, 980px)' : '100%',
        left: '50%',
        maxWidth: 'none',
        top: variant === 'hero' ? '48%' : '50%',
        transform: 'translate3d(-50%, -50%, 0)',
        width: variant === 'hero' ? 'max(142vw, 1540px)' : '100%',
    };

    return (
        <div
            className={`public-visual-copy rejourney-orbital-field rejourney-orbital-field--${variant} pointer-events-none absolute inset-0 z-[1] overflow-visible ${className}`}
            aria-hidden="true"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                        @keyframes rejourneyPastelDrift {
                            0% { transform: translate3d(-1.5%, -1%, 0) scale(1); opacity: .34; }
                            100% { transform: translate3d(1.5%, 1%, 0) scale(1.025); opacity: .46; }
                        }
                        .rejourney-orbital-bg {
                            position: absolute;
                            inset: 0;
                            background:
                                linear-gradient(118deg, rgba(224,242,254,.86) 0%, rgba(248,250,252,.92) 40%, rgba(245,243,255,.9) 75%, rgba(255,255,255,1) 100%),
                                linear-gradient(180deg, #f6fbff 0%, #ffffff 100%);
                        }
                        .rejourney-orbital-haze {
                            position: absolute;
                            inset: -10% -14%;
                            background:
                                radial-gradient(ellipse at 18% 28%, rgba(125,211,252,.18), transparent 38%),
                                radial-gradient(ellipse at 80% 24%, rgba(196,181,253,.20), transparent 38%),
                                radial-gradient(ellipse at 58% 84%, rgba(147,197,253,.16), transparent 36%);
                            filter: blur(34px);
                            animation: rejourneyPastelDrift 18s ease-in-out infinite alternate;
                        }
                        @keyframes rejourneyPlanetGridSpin {
                            0% { transform: rotate(var(--grid-rotate)); }
                            100% { transform: rotate(calc(var(--grid-rotate) + 360deg)); }
                        }
                        .rejourney-reference-planet {
                            position: absolute;
                            left: 50%;
                            top: clamp(620px, 58%, 760px);
                            width: min(56vw, 760px);
                            aspect-ratio: 1;
                            transform: translate3d(-50%, 0, 0);
                            border-radius: 50%;
                            background:
                                radial-gradient(circle at 50% 20%, rgba(255,255,255,.96), rgba(239,246,255,.78) 35%, rgba(219,234,254,.48) 61%, rgba(148,163,184,.22) 100%),
                                linear-gradient(135deg, rgba(255,255,255,.78), rgba(191,219,254,.2));
                            box-shadow:
                                inset 0 22px 70px rgba(255,255,255,.78),
                                inset 0 -34px 80px rgba(99,102,241,.1),
                                0 -18px 42px rgba(15,23,42,.1),
                                0 0 0 1px rgba(148,163,184,.12);
                            opacity: .9;
                        }
                        .rejourney-reference-planet::before,
                        .rejourney-reference-planet::after {
                            content: "";
                            position: absolute;
                            inset: 6%;
                            border-radius: 50%;
                            border: 1px solid rgba(125, 211, 252, .22);
                            clip-path: polygon(0 0, 100% 0, 100% 66%, 0 66%);
                            --grid-rotate: 0deg;
                            animation: rejourneyPlanetGridSpin 34s linear infinite;
                        }
                        .rejourney-reference-planet::after {
                            inset: 14%;
                            border-color: rgba(167, 139, 250, .18);
                            --grid-rotate: 18deg;
                            animation-duration: 46s;
                            animation-direction: reverse;
                        }
                        .rejourney-orbital-field--hero {
                            -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 85%, transparent 100%);
                            mask-image: linear-gradient(180deg, #000 0%, #000 85%, transparent 100%);
                            -webkit-mask-size: 100% 100%;
                            mask-size: 100% 100%;
                            -webkit-mask-repeat: no-repeat;
                            mask-repeat: no-repeat;
                        }
                        .rejourney-orbital-field--hero .rejourney-orbital-canvas {
                            opacity: .86;
                        }
                        .rejourney-orbital-field--sparse .rejourney-orbital-canvas {
                            opacity: .3;
                        }
                        @media (max-width: 720px) {
                            .rejourney-reference-planet {
                                width: 690px;
                                top: 620px;
                            }
                            .rejourney-orbital-field--hero .rejourney-orbital-canvas {
                                opacity: .62;
                            }
                        }
                        @media (prefers-reduced-motion: reduce) {
                            .rejourney-orbital-haze,
                            .rejourney-reference-planet::before,
                            .rejourney-reference-planet::after {
                                animation: none;
                            }
                        }
                    `,
                }}
            />
            {variant === 'hero' ? <div className="rejourney-orbital-bg" /> : null}
            <div className="rejourney-orbital-haze" />
            <canvas
                ref={canvasRef}
                data-testid={`futuristic-growth-field-${variant}`}
                className="rejourney-orbital-canvas absolute"
                style={canvasStyle}
            />
        </div>
    );
};

import React, { useEffect, useRef } from 'react';
import type { BufferAttribute, Group, Line, LineBasicMaterial, Mesh } from 'three';

type LandingThreeFieldProps = {
    className?: string;
    seed?: number;
    variant?: 'landing-hero' | 'landing-page' | 'landing-sparse' | 'how-it-works-hero';
};

type ParticleState = {
    x: number;
    y: number;
    z: number;
    drift: number;
    phase: number;
    speed: number;
};

type FlowLineState = {
    line: Line;
    material: LineBasicMaterial;
    baseOpacity: number;
    phase: number;
    speed: number;
    sway: number;
    y: number;
};

type SparseMeshState = {
    mesh: Mesh;
    baseX: number;
    baseY: number;
    baseZ: number;
    drift: number;
    phase: number;
    speed: number;
    spin: number;
};

const createSeededRandom = (seed: number) => {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;

    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
};

export const LandingThreeField: React.FC<LandingThreeFieldProps> = ({
    className = '',
    seed = 42,
    variant = 'landing-hero',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    
    const isHero = variant === 'landing-hero';
    const isHowItWorks = variant === 'how-it-works-hero';
    const isLandingPage = variant === 'landing-page';
    const isLandingSparse = variant === 'landing-sparse';
    const isAmbient = isLandingPage || isLandingSparse;
    const isHeroOrHowItWorks = isHero || isHowItWorks;

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

            const random = createSeededRandom(seed);
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const initialWidth = container.clientWidth || window.innerWidth || 1024;
            const startsSmall = initialWidth < 640;

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setClearAlpha(0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, startsSmall ? 1.1 : (isHeroOrHowItWorks ? 1.5 : 1.0)));
            renderer.outputColorSpace = THREE.SRGBColorSpace;

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
            camera.position.set(0, 0, 8.5);

            const disposables: Array<{ dispose: () => void }> = [];
            const register = <T extends { dispose: () => void }>(item: T) => {
                disposables.push(item);
                return item;
            };

            const createParticleTexture = () => {
                const sprite = document.createElement('canvas');
                sprite.width = 64;
                sprite.height = 64;
                const ctx = sprite.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, 64, 64);
                    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
                    gradient.addColorStop(0, 'rgba(255,255,255,1)');
                    gradient.addColorStop(0.2, 'rgba(226,232,240,0.80)');
                    gradient.addColorStop(0.5, 'rgba(203,213,225,0.25)');
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, 64, 64);
                }
                const texture = new THREE.CanvasTexture(sprite);
                texture.needsUpdate = true;
                return register(texture);
            };

            const particleTexture = createParticleTexture();

            // Ambient background lighting
            scene.add(new THREE.AmbientLight(0xfafafa, isHeroOrHowItWorks ? 3.0 : 2.2));

            // Floating neon point lights to illuminate the hero globe (only for heroes)
            const cyanLight = new THREE.PointLight(0xfafafa, 0, 20);
            scene.add(cyanLight);

            const blueLight = new THREE.PointLight(0xfafafa, 0, 18);
            scene.add(blueLight);

            const azureLight = new THREE.PointLight(0xfafafa, 0, 16);
            scene.add(azureLight);

            // Add a directional light for specular highlights
            const dirLight = new THREE.DirectionalLight(0xffffff, isHeroOrHowItWorks ? 0.6 : 0);
            dirLight.position.set(5, 5, 4);
            scene.add(dirLight);

            const root = new THREE.Group();
            root.position.set(0, 0, 0);
            scene.add(root);

            // Create background stars/particles
            const starCount = isHeroOrHowItWorks ? 48 : (isLandingPage ? (startsSmall ? 82 : 180) : (startsSmall ? 48 : 90));
            const starPositions = new Float32Array(starCount * 3);
            const starColors = new Float32Array(starCount * 3);
            const starSizes = new Float32Array(starCount);
            const starStates: ParticleState[] = [];
            const starPalette = [0xf8fafc, 0xf1f5f9, 0xe2e8f0, 0xcbd5e1, 0xffffff];

            for (let i = 0; i < starCount; i++) {
                const x = (random() - 0.5) * 16.0;
                const y = (random() - 0.5) * 10.0;
                const z = -2.0 - random() * 4.0;

                const color = new THREE.Color(starPalette[Math.floor(random() * starPalette.length)]);
                const brightness = isLandingPage ? 0.66 + random() * 0.7 : 0.52 + random() * 0.62;

                starPositions[i * 3] = x;
                starPositions[i * 3 + 1] = y;
                starPositions[i * 3 + 2] = z;
                starColors[i * 3] = color.r * brightness;
                starColors[i * 3 + 1] = color.g * brightness;
                starColors[i * 3 + 2] = color.b * brightness;
                starSizes[i] = random() * (isHeroOrHowItWorks ? 0.07 : (isLandingPage ? (startsSmall ? 0.11 : 0.16) : 0.12)) + (isHeroOrHowItWorks ? 0.024 : (isLandingPage ? (startsSmall ? 0.04 : 0.06) : 0.045));

                starStates.push({
                    x,
                    y,
                    z,
                    drift: 0.02 + random() * 0.05,
                    phase: random() * Math.PI * 2,
                    speed: (0.15 + random() * 0.25) * 0.28,
                });
            }

            const starGeometry = register(new THREE.BufferGeometry());
            starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
            starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
            starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

            const starMaterial = register(new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: particleTexture },
                    opacity: { value: isHeroOrHowItWorks ? 0.28 : (isLandingPage ? (startsSmall ? 0.28 : 0.35) : 0.30) },
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
                blending: isLandingPage ? THREE.NormalBlending : THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const stars = new THREE.Points(starGeometry, starMaterial);
            root.add(stars);

            let knotMesh: Mesh | null = null;
            let ring1: Mesh | null = null;
            let ring2: Mesh | null = null;
            let ring3: Mesh | null = null;
            let ring1Group: Group | null = null;
            let ring2Group: Group | null = null;
            let flowGroup: Group | null = null;
            const flowLines: FlowLineState[] = [];
            const sparseMeshes: SparseMeshState[] = [];

            const pipelineNodes: Mesh[] = [];
            const pipelineCurves: any[] = [];
            const pipelinePackets: Mesh[] = [];
            const packetStates: Array<{ curveIndex: number; progress: number; speed: number }> = [];
            let pipelineGroup: Group | null = null;

            if (isHowItWorks) {
                pipelineGroup = new THREE.Group();
                root.add(pipelineGroup);

                // Define 4 nodes along a wavy path
                const nodePositions = [
                    new THREE.Vector3(-3.5, 1.2, -0.5),
                    new THREE.Vector3(-1.2, -1.0, 0.2),
                    new THREE.Vector3(1.2, 1.0, -0.2),
                    new THREE.Vector3(3.5, -1.2, 0.5)
                ];

                const nodeGeometries = [
                    new THREE.SphereGeometry(0.35, 16, 16),
                    new THREE.IcosahedronGeometry(0.38, 1),
                    new THREE.OctahedronGeometry(0.38, 1),
                    new THREE.TorusKnotGeometry(0.24, 0.06, 48, 6)
                ];

                const nodeColors = [0xcbd5e1, 0xe2e8f0, 0xcbd5e1, 0xe2e8f0];

                // Create the node meshes
                for (let i = 0; i < 4; i++) {
                    const material = register(new THREE.MeshBasicMaterial({
                        color: nodeColors[i],
                        wireframe: true,
                        transparent: true,
                        opacity: 0.35,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    }));
                    const mesh = new THREE.Mesh(nodeGeometries[i], material);
                    mesh.position.copy(nodePositions[i]);
                    pipelineGroup.add(mesh);
                    pipelineNodes.push(mesh);
                }

                // Create curved connection paths between adjacent nodes
                for (let i = 0; i < 3; i++) {
                    const start = nodePositions[i];
                    const end = nodePositions[i + 1];
                    
                    // Add control points to make a nice wave
                    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                    mid.y += (i % 2 === 0 ? 0.6 : -0.6); // alternate curve offset
                    mid.z += 0.4;

                    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
                    pipelineCurves.push(curve);

                    // Draw the connection path line
                    const points = curve.getPoints(60);
                    const lineGeom = register(new THREE.BufferGeometry().setFromPoints(points));
                    const lineMat = register(new THREE.LineBasicMaterial({
                        color: 0xcbd5e1,
                        transparent: true,
                        opacity: 0.18,
                        depthWrite: false,
                        blending: THREE.NormalBlending
                    }));
                    const line = new THREE.Line(lineGeom, lineMat);
                    pipelineGroup.add(line);
                }

                // Create flying data packets
                const packetGeom = register(new THREE.SphereGeometry(0.06, 8, 8));
                const packetColor = 0xf1f5f9;
                
                // We'll create 12 packets distributed across paths
                for (let i = 0; i < 12; i++) {
                    const packetMat = register(new THREE.MeshBasicMaterial({
                        color: packetColor,
                        transparent: true,
                        opacity: 0.8,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    }));
                    const packet = new THREE.Mesh(packetGeom, packetMat);
                    pipelineGroup.add(packet);
                    pipelinePackets.push(packet);

                    const curveIndex = i % 3;
                    const progress = random();
                    const speed = 0.08 + random() * 0.12;
                    packetStates.push({ curveIndex, progress, speed });
                }
            }

            if (isHero) {
                const globeGeometry = register(new THREE.SphereGeometry(2.25, 42, 24));
                const globeSurfaceMaterial = register(new THREE.MeshPhysicalMaterial({
                    color: 0xe2e8f0,
                    metalness: 0.02,
                    roughness: 0.22,
                    clearcoat: 0.75,
                    clearcoatRoughness: 0.18,
                    transparent: true,
                    opacity: 0.17,
                    depthWrite: false,
                }));
                knotMesh = new THREE.Mesh(globeGeometry, globeSurfaceMaterial);
                root.add(knotMesh);

                const globeWireframeMat = register(new THREE.MeshBasicMaterial({
                    color: 0xcbd5e1,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.20,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                }));
                const globeWireframe = new THREE.Mesh(globeGeometry, globeWireframeMat);
                globeWireframe.scale.setScalar(1.004);
                knotMesh.add(globeWireframe);

                const ringMaterial = register(new THREE.MeshBasicMaterial({
                    color: 0xe2e8f0,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.18,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                }));

                ring1Group = new THREE.Group();
                ring1Group.rotation.x = Math.PI / 2.65;
                ring1Group.rotation.z = Math.PI / 10;
                root.add(ring1Group);

                ring1 = new THREE.Mesh(register(new THREE.TorusGeometry(2.62, 0.009, 6, 140)), ringMaterial);
                ring1Group.add(ring1);

                ring2Group = new THREE.Group();
                ring2Group.rotation.y = Math.PI / 2.85;
                ring2Group.rotation.x = -Math.PI / 7.5;
                root.add(ring2Group);

                ring2 = new THREE.Mesh(register(new THREE.TorusGeometry(2.95, 0.007, 6, 140)), ringMaterial);
                ring2Group.add(ring2);
            } else if (isAmbient) {
                if (!isLandingPage) {
                    const ringMaterial = register(new THREE.MeshBasicMaterial({
                        color: 0xcbd5e1,
                        wireframe: true,
                        transparent: true,
                        opacity: 0.16,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));

                    ring1 = new THREE.Mesh(register(new THREE.TorusGeometry(3.2, 0.22, 8, 80)), ringMaterial);
                    ring1.rotation.x = Math.PI / 4.2;
                    ring1.position.set(-3.5, 1.8, -1.2);
                    ring1.scale.setScalar(1.2);
                    root.add(ring1);

                    ring2 = new THREE.Mesh(register(new THREE.TorusGeometry(3.6, 0.18, 6, 60)), ringMaterial);
                    ring2.rotation.y = Math.PI / 3.5;
                    ring2.position.set(4.0, -1.8, -1.4);
                    ring2.scale.setScalar(1.25);
                    root.add(ring2);

                    ring3 = new THREE.Mesh(register(new THREE.TorusGeometry(2.8, 0.12, 4, 50)), ringMaterial);
                    ring3.rotation.z = Math.PI / 6;
                    ring3.rotation.x = -Math.PI / 4;
                    ring3.position.set(0, 0, -1.0);
                    ring3.scale.setScalar(0.9);
                    root.add(ring3);

                    const createWireMaterial = (color: number, opacity: number) => register(new THREE.MeshBasicMaterial({
                        color,
                        wireframe: true,
                        transparent: true,
                        opacity,
                        blending: THREE.NormalBlending,
                        depthWrite: false,
                    }));

                    const addSparseMesh = (mesh: Mesh, x: number, y: number, z: number, scale: number) => {
                        mesh.position.set(x, y, z);
                        mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
                        mesh.scale.setScalar(scale);
                        root.add(mesh);
                        sparseMeshes.push({
                            mesh,
                            baseX: x,
                            baseY: y,
                            baseZ: z,
                            drift: 0.16 + random() * 0.34,
                            phase: random() * Math.PI * 2,
                            speed: 0.08 + random() * 0.16,
                            spin: 0.35 + random() * 0.7,
                        });
                    };

                    addSparseMesh(
                        new THREE.Mesh(
                            register(new THREE.SphereGeometry(1.05, 26, 15)),
                            createWireMaterial(0xe2e8f0, 0.18),
                        ),
                        -5.35,
                        2.35,
                        -1.2,
                        1.0,
                    );
                    addSparseMesh(
                        new THREE.Mesh(
                            register(new THREE.IcosahedronGeometry(1.05, 1)),
                            createWireMaterial(0xcbd5e1, 0.14),
                        ),
                        5.05,
                        1.15,
                        -1.8,
                        0.92,
                    );
                    addSparseMesh(
                        new THREE.Mesh(
                            register(new THREE.OctahedronGeometry(0.92, 1)),
                            createWireMaterial(0xe2e8f0, 0.12),
                        ),
                        -1.75,
                        -2.25,
                        -1.4,
                        0.95,
                    );
                    addSparseMesh(
                        new THREE.Mesh(
                            register(new THREE.TorusKnotGeometry(0.72, 0.045, 96, 8)),
                            createWireMaterial(0xf1f5f9, 0.10),
                        ),
                        2.1,
                        2.95,
                        -2.1,
                        0.9,
                    );
                }

                if (isLandingPage) {
                    flowGroup = new THREE.Group();
                    flowGroup.position.set(0, -0.15, -0.4);
                    root.add(flowGroup);

                    const flowPalette = [0xe2e8f0, 0xcbd5e1, 0xf1f5f9, 0xe2e8f0, 0xf8fafc];
                    for (let i = 0; i < 11; i++) {
                        const points = [];
                        const phase = random() * Math.PI * 2;
                        const y = -4.45 + i * 0.92 + (random() - 0.5) * 0.5;
                        const z = -3.45 - random() * 2.1;

                        for (let j = 0; j < 10; j++) {
                            const t = j / 9;
                            const x = -8.8 + t * 17.6;
                            const wave = Math.sin(t * Math.PI * 2.1 + phase) * (0.32 + random() * 0.28);
                            const lift = Math.sin(t * Math.PI + i * 0.45) * 0.68;
                            points.push(new THREE.Vector3(x, y + wave + lift, z + Math.sin(t * Math.PI * 2 + phase) * 0.35));
                        }

                        const curve = new THREE.CatmullRomCurve3(points);
                        const geometry = register(new THREE.BufferGeometry().setFromPoints(curve.getPoints(180)));
                        const material = register(new THREE.LineBasicMaterial({
                            color: flowPalette[i % flowPalette.length],
                            transparent: true,
                            opacity: 0.08 + random() * 0.06,
                            blending: THREE.NormalBlending,
                            depthWrite: false,
                        }));
                        const line = new THREE.Line(geometry, material);
                        line.position.x = (random() - 0.5) * 0.9;
                        flowGroup.add(line);
                        flowLines.push({
                            line,
                            material,
                            baseOpacity: material.opacity,
                            phase,
                            speed: 0.085 + random() * 0.085,
                            sway: 0.16 + random() * 0.26,
                            y: line.position.y,
                        });
                    }
                }
            }

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;

                if (isLandingPage) {
                    camera.position.z = width < 640 ? 8.4 : 7.35;
                    root.position.set(0, 0, 0);
                    root.scale.setScalar(width < 640 ? 1.04 : 1.18);
                } else if (isLandingSparse) {
                    camera.position.z = width < 640 ? 8.45 : 7.5;
                    root.position.set(width < 640 ? 0.2 : 0, width < 640 ? -0.2 : 0, 0);
                    root.scale.setScalar(width < 640 ? 0.76 : (width < 1024 ? 0.9 : 1.0));
                } else if (isHowItWorks) {
                    camera.position.z = width < 640 ? 9.5 : 8.5;
                    root.position.set(0, 0, 0);
                    root.scale.setScalar(width < 640 ? 0.8 : 1.1);
                } else if (width < 640) {
                    camera.position.z = 9.3;
                    root.position.set(width < 430 ? 0.98 : 1.12, -1.42, -0.35);
                    root.scale.setScalar(width < 430 ? 0.78 : 0.86);
                } else if (width < 1024) {
                    camera.position.z = 9.0;
                    root.position.set(1.05, 0.12, 0);
                    root.scale.setScalar(0.86);
                } else {
                    camera.position.z = 8.5;
                    root.position.set(2.65, 0.02, 0);
                    root.scale.setScalar(1.02);
                }

                camera.updateProjectionMatrix();
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

            const renderFrame = () => {
                frameId = 0;
                const elapsed = clock.getElapsedTime();

                // Rotate the hero globe and background groups
                if (isHero && knotMesh && ring1Group && ring2Group) {
                    const heroMotion = 0.46;
                    knotMesh.rotation.x = elapsed * 0.15 * heroMotion;
                    knotMesh.rotation.y = elapsed * 0.2 * heroMotion;
                    knotMesh.rotation.z = elapsed * 0.08 * heroMotion;

                    ring1Group.rotation.z = -elapsed * 0.12 * heroMotion;
                    ring2Group.rotation.z = elapsed * 0.08 * heroMotion;
                } else if (isAmbient && ring1 && ring2 && ring3) {
                    const ambientSpeed = 1.0;
                    ring1.rotation.x = elapsed * 0.015 * ambientSpeed;
                    ring1.rotation.y = elapsed * 0.012 * ambientSpeed;
                    ring2.rotation.y = -elapsed * 0.008 * ambientSpeed;
                    ring2.rotation.z = elapsed * 0.006 * ambientSpeed;
                    ring3.rotation.x = -elapsed * 0.005 * ambientSpeed;
                    ring3.rotation.z = -elapsed * 0.01 * ambientSpeed;
                }

                if (isLandingSparse && sparseMeshes.length) {
                    sparseMeshes.forEach((shape, index) => {
                        const pulse = elapsed * shape.speed + shape.phase;
                        shape.mesh.position.x = shape.baseX + Math.sin(pulse) * shape.drift;
                        shape.mesh.position.y = shape.baseY + Math.cos(pulse * 0.82 + index) * shape.drift * 0.74;
                        shape.mesh.position.z = shape.baseZ + Math.sin(pulse * 0.62) * shape.drift * 0.45;
                        shape.mesh.rotation.x += 0.0025 * shape.spin;
                        shape.mesh.rotation.y += 0.0035 * shape.spin;
                    });
                }

                if (isHowItWorks && pipelineGroup && pipelineNodes.length) {
                    pipelineNodes.forEach((node, i) => {
                        node.rotation.x = elapsed * 0.22 * (i % 2 === 0 ? 1 : -1);
                        node.rotation.y = elapsed * 0.28;
                        node.rotation.z = elapsed * 0.12;
                    });

                    pipelinePackets.forEach((packet, i) => {
                        const state = packetStates[i];
                        const t = (elapsed * state.speed + state.progress) % 1.0;
                        const curve = pipelineCurves[state.curveIndex];
                        if (curve) {
                            const pos = curve.getPointAt(t);
                            packet.position.copy(pos);
                            
                            const opacity = Math.sin(t * Math.PI) * 0.85;
                            const mat = packet.material as any;
                            if (mat) mat.opacity = opacity;
                        }
                    });
                }

                root.rotation.y = Math.sin(elapsed * (isLandingPage ? 0.07 : 0.1)) * (isLandingPage ? 0.025 : 0.05);
                if (isLandingPage) {
                    root.rotation.x = Math.sin(elapsed * 0.06) * 0.026;
                    root.position.y = Math.cos(elapsed * 0.05) * 0.24;
                    stars.rotation.z = Math.sin(elapsed * 0.052) * 0.02;
                    if (flowGroup) {
                        flowGroup.rotation.z = Math.sin(elapsed * 0.055) * 0.026;
                        flowGroup.position.x = Math.sin(elapsed * 0.04) * 0.34;
                        flowGroup.position.y = -0.25 + Math.cos(elapsed * 0.046) * 0.32;
                        flowLines.forEach((flow, index) => {
                            const pulse = elapsed * flow.speed + flow.phase;
                            flow.line.position.x = Math.sin(pulse) * flow.sway;
                            flow.line.position.y = flow.y + Math.cos(pulse * 0.8 + index) * 0.14;
                            flow.material.opacity = flow.baseOpacity * (0.62 + Math.sin(pulse * 1.45) * 0.38);
                        });
                    }
                }

                // Orbit point lights around the hero globe
                if (isHeroOrHowItWorks) {
                    const lightTime1 = elapsed * 0.6;
                    cyanLight.position.x = Math.sin(lightTime1) * 3.2;
                    cyanLight.position.z = Math.cos(lightTime1) * 3.2;
                    cyanLight.position.y = Math.sin(lightTime1 * 0.5) * 1.5;

                    const lightTime2 = elapsed * 0.4 + 2.0;
                    blueLight.position.y = Math.sin(lightTime2) * 3.0;
                    blueLight.position.z = Math.cos(lightTime2) * 3.0;
                    blueLight.position.x = Math.cos(lightTime2 * 0.7) * 1.8;

                    const lightTime3 = elapsed * 0.5 + 4.0;
                    azureLight.position.x = Math.cos(lightTime3) * 3.5;
                    azureLight.position.y = Math.sin(lightTime3) * 3.5;
                    azureLight.position.z = Math.sin(lightTime3 * 0.8) * 2.0;
                }

                // Animate background particles
                const starPosAttr = starGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < starCount; i++) {
                    const star = starStates[i];
                    const driftX = Math.sin(elapsed * star.speed + star.phase) * star.drift;
                    const driftY = Math.cos(elapsed * star.speed * 0.8 + star.phase) * star.drift;
                    starPosAttr.setXYZ(i, star.x + driftX, star.y + driftY, star.z);
                }
                starPosAttr.needsUpdate = true;

                // Dynamic scale pulsing on the hero globe
                if (isHero && knotMesh && !reducedMotion) {
                    const scalePulse = 1.0 + Math.sin(elapsed * 0.8) * 0.02;
                    knotMesh.scale.set(scalePulse, scalePulse, scalePulse);
                }

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

    const canvasStyle: React.CSSProperties = isLandingPage
        ? {
            height: '100%',
            inset: 0,
            maxWidth: 'none',
            width: '100%',
        }
        : {
            height: isHeroOrHowItWorks ? 'max(140%, 1020px)' : '100%',
            left: '50%',
            maxWidth: 'none',
            top: isHeroOrHowItWorks ? '48%' : '50%',
            transform: 'translate3d(-50%, -50%, 0)',
            width: isHeroOrHowItWorks ? 'max(145vw, 1580px)' : '100%',
        };
    const variantClassName = isLandingPage
        ? 'landing-three-field--page'
        : (isHeroOrHowItWorks ? 'landing-three-field--hero' : 'landing-three-field--sparse');
    const wrapperClassName = isLandingPage
        ? `pointer-events-none fixed inset-0 z-0 overflow-hidden ${variantClassName} ${className}`
        : `pointer-events-none absolute inset-0 z-0 overflow-hidden ${isHeroOrHowItWorks ? '' : 'lg:overflow-visible'} ${variantClassName} ${className}`;

    return (
        <div
            className={wrapperClassName}
            aria-hidden="true"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                        @keyframes landingHazeDrift {
                            0% { transform: translate3d(-2%, -1.5%, 0) scale(1); opacity: 0.35; }
                            100% { transform: translate3d(2%, 1.5%, 0) scale(1.03); opacity: 0.55; }
                        }
                        .landing-light-bg {
                            position: absolute;
                            inset: 0;
                            background:
                                radial-gradient(circle at 80% 20%, rgba(37, 99, 235, 0.09), transparent 50%),
                                radial-gradient(circle at 20% 80%, rgba(16, 185, 129, 0.07), transparent 45%),
                                radial-gradient(circle at 50% 58%, rgba(245, 158, 11, 0.045), transparent 42%),
                                linear-gradient(180deg, #ffffff 0%, #fcfdfe 100%);
                        }
                        .landing-light-haze {
                            position: absolute;
                            inset: -12% -15%;
                            background:
                                radial-gradient(ellipse at 75% 20%, rgba(37, 99, 235, 0.09), transparent 50%),
                                radial-gradient(ellipse at 25% 70%, rgba(16, 185, 129, 0.08), transparent 45%),
                                radial-gradient(ellipse at 54% 48%, rgba(245, 158, 11, 0.045), transparent 42%);
                            filter: blur(45px);
                            animation: landingHazeDrift 28s ease-in-out infinite alternate;
                        }
                        .landing-three-field--hero .landing-three-canvas {
                            opacity: 0.46;
                        }
                        .landing-three-field--page .landing-three-canvas {
                            filter: saturate(1.18) contrast(1.06);
                            opacity: 0.94;
                        }
                        .landing-three-field--sparse .landing-three-canvas {
                            opacity: 0.64;
                        }
                        @media (max-width: 640px) {
                            .landing-three-field--hero .landing-light-bg {
                                background:
                                    radial-gradient(circle at 76% 28%, rgba(37, 99, 235, 0.065), transparent 42%),
                                    radial-gradient(circle at 20% 72%, rgba(16, 185, 129, 0.055), transparent 42%),
                                    linear-gradient(180deg, #ffffff 0%, #fcfdfe 100%);
                            }
                            .landing-three-field--hero .landing-light-haze {
                                inset: -4% -10%;
                                filter: blur(38px);
                                opacity: 0.54;
                            }
                            .landing-three-field--hero .landing-three-canvas {
                                height: 100% !important;
                                left: 50% !important;
                                opacity: 0.46;
                                top: 50% !important;
                                width: 100% !important;
                            }
                            .landing-three-field--page .landing-three-canvas {
                                filter: saturate(0.9) contrast(0.98);
                                opacity: 0.34;
                            }
                            .landing-three-field--sparse .landing-three-canvas {
                                opacity: 0.38;
                            }
                        }
                        @media (prefers-reduced-motion: reduce) {
                            .landing-light-haze {
                                animation: none;
                            }
                        }
                    `,
                }}
            />
            {isHero && <div className="landing-light-bg" />}
            {isHero && <div className="landing-light-haze" />}
            <canvas
                ref={canvasRef}
                className="landing-three-canvas absolute"
                style={canvasStyle}
            />
        </div>
    );
};

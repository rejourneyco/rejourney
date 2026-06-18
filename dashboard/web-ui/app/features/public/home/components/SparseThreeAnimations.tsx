import React, { useEffect, useRef } from 'react';
import type { BufferAttribute, Group, Object3D } from 'three';

type SparseAnimationProps = {
    className?: string;
    seed?: number;
};

// Seeded random helper for predictable visual distribution
const createSeededRandom = (seed: number) => {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
};

/**
 * 1. NetworkConstellation: A sparse neural net/constellation of nodes
 * connected by fading lines, reacting gently to mouse movement.
 */
export const NetworkConstellation: React.FC<SparseAnimationProps> = ({
    className = '',
    seed = 88,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined' || !canvasRef.current || !containerRef.current) return;

        let frameId = 0;
        let disposed = false;
        let isVisible = true;
        let resizeObserver: ResizeObserver | null = null;
        let visibilityObserver: IntersectionObserver | null = null;
        let teardownScene: (() => void) | null = null;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        const random = createSeededRandom(seed);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Tracks mouse in Normalized Device Coordinates (NDC)
        const mouse = { x: -9999, y: -9999 };

        const handleMouseMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };

        const handleMouseLeave = () => {
            mouse.x = -9999;
            mouse.y = -9999;
        };

        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        container.addEventListener('mouseleave', handleMouseLeave, { passive: true });

        const bootScene = async () => {
            const THREE = await import('three');
            if (disposed || !canvasRef.current) return;

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setClearAlpha(0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
            camera.position.set(0, 0, 7.5);

            const disposables: Array<{ dispose: () => void }> = [];
            const register = <T extends { dispose: () => void }>(item: T) => {
                disposables.push(item);
                return item;
            };

            // Programmatically create smooth circular particle sprite
            const createCircleTexture = () => {
                const sprite = document.createElement('canvas');
                sprite.width = 32;
                sprite.height = 32;
                const ctx = sprite.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, 32, 32);
                    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
                    gradient.addColorStop(0, 'rgba(255,255,255,1)');
                    gradient.addColorStop(0.3, 'rgba(56,189,248,0.7)');
                    gradient.addColorStop(0.7, 'rgba(37,99,235,0.2)');
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, 32, 32);
                }
                const texture = new THREE.CanvasTexture(sprite);
                texture.needsUpdate = true;
                return register(texture);
            };

            const particleTexture = createCircleTexture();

            // Set up sparse node structures
            const nodeCount = 42;
            const nodePositions = new Float32Array(nodeCount * 3);
            const nodeStates: Array<{
                x: number;
                y: number;
                z: number;
                vx: number;
                vy: number;
                vz: number;
                baseSpeed: number;
                phase: number;
            }> = [];

            for (let i = 0; i < nodeCount; i++) {
                const x = (random() - 0.5) * 8.0;
                const y = (random() - 0.5) * 4.5;
                const z = (random() - 0.5) * 1.5;

                nodePositions[i * 3] = x;
                nodePositions[i * 3 + 1] = y;
                nodePositions[i * 3 + 2] = z;

                const baseSpeed = 0.006 + random() * 0.009;
                const angle = random() * Math.PI * 2;

                nodeStates.push({
                    x,
                    y,
                    z,
                    vx: Math.cos(angle) * baseSpeed,
                    vy: Math.sin(angle) * baseSpeed,
                    vz: (random() - 0.5) * baseSpeed,
                    baseSpeed,
                    phase: random() * Math.PI,
                });
            }

            const pointsGeometry = register(new THREE.BufferGeometry());
            pointsGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));

            const pointsMaterial = register(new THREE.PointsMaterial({
                color: 0x38bdf8,
                size: 0.2,
                transparent: true,
                opacity: 0.92,
                map: particleTexture,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const points = new THREE.Points(pointsGeometry, pointsMaterial);
            scene.add(points);

            // Set up dynamic lines
            const maxLines = 80;
            const linePositions = new Float32Array(maxLines * 2 * 3);
            const lineColors = new Float32Array(maxLines * 2 * 3);
            const lineGeometry = register(new THREE.BufferGeometry());
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
            lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

            const lineMaterial = register(new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.48,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
            scene.add(lineSegments);

            // Plane at z=0 for raycasting mouse coordinates
            const rayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            const raycaster = new THREE.Raycaster();
            const mouseCoords = new THREE.Vector3();

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            };

            resize();
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);

            teardownScene = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                resizeObserver?.disconnect();
                visibilityObserver?.disconnect();
                window.removeEventListener('mousemove', handleMouseMove);
                container.removeEventListener('mouseleave', handleMouseLeave);
                disposables.forEach((d) => d.dispose());
                renderer.dispose();
            };

            const clock = new THREE.Clock();

            const renderFrame = () => {
                frameId = 0;
                const elapsed = clock.getElapsedTime();

                // Compute mouse 3D coords
                let mouseActive = false;
                if (mouse.x > -2 && mouse.y > -2) {
                    raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
                    raycaster.ray.intersectPlane(rayPlane, mouseCoords);
                    mouseActive = true;
                }

                // Update particle positions
                const posAttr = pointsGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < nodeCount; i++) {
                    const state = nodeStates[i];

                    // Gentle drift
                    state.x += state.vx;
                    state.y += state.vy;
                    state.z += state.vz;

                    // Bounce/wrap borders
                    const xLimit = camera.aspect * 3.6;
                    const yLimit = 2.2;
                    if (Math.abs(state.x) > xLimit) {
                        state.vx *= -1;
                        state.x = Math.sign(state.x) * xLimit;
                    }
                    if (Math.abs(state.y) > yLimit) {
                        state.vy *= -1;
                        state.y = Math.sign(state.y) * yLimit;
                    }
                    if (Math.abs(state.z) > 1.2) {
                        state.vz *= -1;
                        state.z = Math.sign(state.z) * 1.2;
                    }

                    // Mouse interaction
                    if (mouseActive) {
                        const dx = state.x - mouseCoords.x;
                        const dy = state.y - mouseCoords.y;
                        const dz = state.z - mouseCoords.z;
                        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                        
                        if (dist < 1.8) {
                            const force = (1.8 - dist) * 0.016;
                            // Push away
                            state.vx += (dx / dist) * force;
                            state.vy += (dy / dist) * force;
                            
                            // Clamp velocities
                            const maxV = 0.05;
                            const speed = Math.sqrt(state.vx*state.vx + state.vy*state.vy);
                            if (speed > maxV) {
                                state.vx = (state.vx / speed) * maxV;
                                state.vy = (state.vy / speed) * maxV;
                            }
                        } else {
                            // Decay velocity back to base
                            state.vx = state.vx * 0.98 + (Math.sign(state.vx) * state.baseSpeed) * 0.02;
                            state.vy = state.vy * 0.98 + (Math.sign(state.vy) * state.baseSpeed) * 0.02;
                        }
                    }

                    posAttr.setXYZ(i, state.x, state.y, state.z);
                }
                posAttr.needsUpdate = true;

                // Update line segments
                let lineIdx = 0;
                const linePosAttr = lineGeometry.getAttribute('position') as BufferAttribute;
                const lineColAttr = lineGeometry.getAttribute('color') as BufferAttribute;

                for (let i = 0; i < nodeCount; i++) {
                    const pi = nodeStates[i];
                    for (let j = i + 1; j < nodeCount; j++) {
                        if (lineIdx >= maxLines) break;
                        const pj = nodeStates[j];

                        const dx = pi.x - pj.x;
                        const dy = pi.y - pj.y;
                        const dz = pi.z - pj.z;
                        const distSq = dx*dx + dy*dy + dz*dz;

                        // Connect if distance < 1.95
                        if (distSq < 3.8) {
                            const dist = Math.sqrt(distSq);
                            const opacity = Math.max(0, 1 - dist / 1.95) * 0.54;

                            // Point A
                            linePosAttr.setXYZ(lineIdx * 2, pi.x, pi.y, pi.z);
                            lineColAttr.setXYZ(lineIdx * 2, 0.22 * opacity, 0.74 * opacity, 0.97 * opacity); // Blue-cyan

                            // Point B
                            linePosAttr.setXYZ(lineIdx * 2 + 1, pj.x, pj.y, pj.z);
                            lineColAttr.setXYZ(lineIdx * 2 + 1, 0.15 * opacity, 0.38 * opacity, 0.92 * opacity); // Indigo-blue

                            lineIdx++;
                        }
                    }
                }
                lineGeometry.setDrawRange(0, lineIdx * 2);
                linePosAttr.needsUpdate = true;
                lineColAttr.needsUpdate = true;

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
            }, { threshold: 0.05 });
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
    }, [seed]);

    return (
        <div ref={containerRef} className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}>
            <canvas ref={canvasRef} className="w-full h-full block opacity-50" />
        </div>
    );
};

/**
 * 2. FloatingDataNodes: Rotating wireframe geometric data nodes
 * drifting slowly, ideal for section sides or clean background visual hooks.
 */
export const FloatingDataNodes: React.FC<SparseAnimationProps & { variant?: 'default' | 'alternate' }> = ({
    className = '',
    seed = 101,
    variant = 'default',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined' || !canvasRef.current || !containerRef.current) return;

        let frameId = 0;
        let disposed = false;
        let isVisible = true;
        let resizeObserver: ResizeObserver | null = null;
        let visibilityObserver: IntersectionObserver | null = null;
        let teardownScene: (() => void) | null = null;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        const random = createSeededRandom(seed);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const bootScene = async () => {
            const THREE = await import('three');
            if (disposed || !canvasRef.current) return;

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setClearAlpha(0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
            camera.position.set(0, 0, 8.0);

            const disposables: Array<{ dispose: () => void }> = [];
            const register = <T extends { dispose: () => void }>(item: T) => {
                disposables.push(item);
                return item;
            };

            // Floating structures group
            const meshesGroup = new THREE.Group();
            scene.add(meshesGroup);

            // Lighting for physical highlights if any
            scene.add(new THREE.AmbientLight(0xdbeafe, 1.2));
            const pointLight = new THREE.PointLight(0x38bdf8, 6.5, 18);
            pointLight.position.set(2, 3, 4);
            scene.add(pointLight);

            // Define geometric structures
            const activeMeshes: Array<{
                group: Group;
                baseX: number;
                baseY: number;
                baseZ: number;
                rotSpeedX: number;
                rotSpeedY: number;
                floatSpeed: number;
                floatAmp: number;
                phase: number;
            }> = [];

            const isAlt = variant === 'alternate';

            const shapesData = isAlt
                ? [
                      // Torus wireframe
                      {
                          geo: register(new THREE.TorusGeometry(0.72, 0.18, 8, 48)),
                          color: 0x60a5fa,
                          x: -2.3,
                          y: 0.6,
                          z: -1.0,
                          rotX: 0.3,
                          rotY: 0.25,
                          floatSp: 0.6,
                          floatAm: 0.22,
                      },
                      // Octahedron wireframe
                      {
                          geo: register(new THREE.OctahedronGeometry(0.75, 1)),
                          color: 0xa78bfa, // Lavender
                          x: 2.1,
                          y: -0.6,
                          z: -1.2,
                          rotX: 0.2,
                          rotY: 0.35,
                          floatSp: 0.45,
                          floatAm: 0.18,
                      },
                  ]
                : [
                      // Double cube wireframe
                      {
                          geo: register(new THREE.BoxGeometry(0.85, 0.85, 0.85)),
                          color: 0x38bdf8, // Cyan
                          x: -2.0,
                          y: -0.5,
                          z: -1.0,
                          rotX: 0.22,
                          rotY: 0.35,
                          floatSp: 0.5,
                          floatAm: 0.25,
                          innerGeo: register(new THREE.BoxGeometry(0.48, 0.48, 0.48)),
                          innerColor: 0x3b82f6, // Blue
                      },
                      // Icosahedron wireframe
                      {
                          geo: register(new THREE.IcosahedronGeometry(0.8, 1)),
                          color: 0x60a5fa,
                          x: 2.2,
                          y: 0.7,
                          z: -1.4,
                          rotX: 0.15,
                          rotY: 0.28,
                          floatSp: 0.4,
                          floatAm: 0.2,
                      },
                  ];

            shapesData.forEach((data) => {
                const group = new THREE.Group();
                group.position.set(data.x, data.y, data.z);

                // Create wireframe outlines
                const edges = register(new THREE.EdgesGeometry(data.geo));
                const mat = register(new THREE.LineBasicMaterial({
                    color: data.color,
                    transparent: true,
                    opacity: 0.82,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                }));
                const line = new THREE.LineSegments(edges, mat);
                group.add(line);

                // Add inner nested mesh if any (only for double cube)
                if ('innerGeo' in data && data.innerGeo) {
                    const innerEdges = register(new THREE.EdgesGeometry(data.innerGeo));
                    const innerMat = register(new THREE.LineBasicMaterial({
                        color: data.innerColor,
                        transparent: true,
                        opacity: 0.9,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    }));
                    const innerLine = new THREE.LineSegments(innerEdges, innerMat);
                    // Slow counter-rotation
                    group.add(innerLine);
                }

                meshesGroup.add(group);

                activeMeshes.push({
                    group,
                    baseX: data.x,
                    baseY: data.y,
                    baseZ: data.z,
                    rotSpeedX: data.rotX,
                    rotSpeedY: data.rotY,
                    floatSpeed: data.floatSp,
                    floatAmp: data.floatAm,
                    phase: random() * Math.PI * 2,
                });
            });

            // Add background drifting micro-particles
            const starCount = 52;
            const starPositions = new Float32Array(starCount * 3);
            const starColors = new Float32Array(starCount * 3);
            const starStates: Array<{ x: number; y: number; z: number; speed: number; phase: number }> = [];
            const starPalette = [0x60a5fa, 0x38bdf8, 0x93c5fd, 0xffffff];

            for (let i = 0; i < starCount; i++) {
                const x = (random() - 0.5) * 8.5;
                const y = (random() - 0.5) * 5.0;
                const z = -2.0 - random() * 2.5;

                starPositions[i * 3] = x;
                starPositions[i * 3 + 1] = y;
                starPositions[i * 3 + 2] = z;

                const color = new THREE.Color(starPalette[Math.floor(random() * starPalette.length)]);
                const brightness = 0.35 + random() * 0.55;
                starColors[i * 3] = color.r * brightness;
                starColors[i * 3 + 1] = color.g * brightness;
                starColors[i * 3 + 2] = color.b * brightness;

                starStates.push({
                    x,
                    y,
                    z,
                    speed: 0.2 + random() * 0.28,
                    phase: random() * Math.PI * 2,
                });
            }

            const starGeometry = register(new THREE.BufferGeometry());
            starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
            starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

            const starCanvas = document.createElement('canvas');
            starCanvas.width = 16;
            starCanvas.height = 16;
            const sCtx = starCanvas.getContext('2d');
            if (sCtx) {
                sCtx.clearRect(0, 0, 16, 16);
                const g = sCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
                g.addColorStop(0, 'rgba(255,255,255,1)');
                g.addColorStop(0.4, 'rgba(56,189,248,0.6)');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                sCtx.fillStyle = g;
                sCtx.fillRect(0, 0, 16, 16);
            }
            const starTexture = register(new THREE.CanvasTexture(starCanvas));

            const starMaterial = register(new THREE.PointsMaterial({
                color: 0xffffff,
                size: 0.105,
                vertexColors: true,
                transparent: true,
                opacity: 0.62,
                map: starTexture,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const stars = new THREE.Points(starGeometry, starMaterial);
            scene.add(stars);

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;

                // Responsive positioning adjustments
                if (width < 768) {
                    // Pull meshes closer inwards on smaller viewports
                    activeMeshes.forEach((mesh, idx) => {
                        mesh.group.position.x = idx === 0 ? -1.0 : 1.0;
                        mesh.baseX = idx === 0 ? -1.0 : 1.0;
                    });
                    meshesGroup.scale.setScalar(0.72);
                } else {
                    activeMeshes.forEach((mesh, idx) => {
                        mesh.group.position.x = idx === 0 ? shapesData[idx].x : shapesData[idx].x;
                        mesh.baseX = shapesData[idx].x;
                    });
                    meshesGroup.scale.setScalar(1.0);
                }

                camera.updateProjectionMatrix();
            };

            resize();
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);

            teardownScene = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                resizeObserver?.disconnect();
                visibilityObserver?.disconnect();
                disposables.forEach((d) => d.dispose());
                renderer.dispose();
            };

            const clock = new THREE.Clock();

            const renderFrame = () => {
                frameId = 0;
                const elapsed = clock.getElapsedTime();

                // Animate rotating floating shapes
                activeMeshes.forEach((m, idx) => {
                    m.group.rotation.x = elapsed * m.rotSpeedX * 1.35;
                    m.group.rotation.y = elapsed * m.rotSpeedY * 1.45;

                    // Separate nested counter-rotation for nested shapes
                    if (m.group.children.length > 1) {
                        const inner = m.group.children[1] as Object3D;
                        inner.rotation.x = -elapsed * m.rotSpeedX * 2.0;
                        inner.rotation.y = -elapsed * m.rotSpeedY * 2.0;
                    }

                    // Float height sinusoidally
                    m.group.position.y = m.baseY + Math.sin(elapsed * m.floatSpeed * 1.25 + m.phase) * (m.floatAmp * 1.22);
                });

                // Gentle drift of micro-particles
                const starPosAttr = starGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < starCount; i++) {
                    const state = starStates[i];
                    const driftX = Math.sin(elapsed * state.speed + state.phase) * 0.075;
                    const driftY = Math.cos(elapsed * state.speed * 0.8 + state.phase) * 0.075;
                    starPosAttr.setXYZ(i, state.x + driftX, state.y + driftY, state.z);
                }
                starPosAttr.needsUpdate = true;

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
            }, { threshold: 0.05 });
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

    return (
        <div ref={containerRef} className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}>
            <canvas ref={canvasRef} className="w-full h-full block opacity-60" />
        </div>
    );
};

/**
 * 3. TechRingsScanner: Concentric wireframe rings spinning on different axes,
 * featuring a central pulsing core/glow. Perfect for CTA background decoration.
 */
export const TechRingsScanner: React.FC<SparseAnimationProps> = ({
    className = '',
    seed = 44,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined' || !canvasRef.current || !containerRef.current) return;

        let frameId = 0;
        let disposed = false;
        let isVisible = true;
        let resizeObserver: ResizeObserver | null = null;
        let visibilityObserver: IntersectionObserver | null = null;
        let teardownScene: (() => void) | null = null;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const bootScene = async () => {
            const THREE = await import('three');
            if (disposed || !canvasRef.current) return;

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setClearAlpha(0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
            camera.position.set(0, 0, 7.0);

            const disposables: Array<{ dispose: () => void }> = [];
            const register = <T extends { dispose: () => void }>(item: T) => {
                disposables.push(item);
                return item;
            };

            const rootGroup = new THREE.Group();
            scene.add(rootGroup);

            // Ring Materials
            const ringMat1 = register(new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                wireframe: true,
                transparent: true,
                opacity: 0.5,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const ringMat2 = register(new THREE.MeshBasicMaterial({
                color: 0x3b82f6,
                wireframe: true,
                transparent: true,
                opacity: 0.38,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const ringMat3 = register(new THREE.MeshBasicMaterial({
                color: 0x60a5fa,
                wireframe: true,
                transparent: true,
                opacity: 0.25,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            // Create 3 Concentric Torus Rings (very thin)
            const ring1 = new THREE.Mesh(register(new THREE.TorusGeometry(1.4, 0.008, 6, 80)), ringMat1);
            const ring2 = new THREE.Mesh(register(new THREE.TorusGeometry(2.0, 0.006, 6, 100)), ringMat2);
            const ring3 = new THREE.Mesh(register(new THREE.TorusGeometry(2.6, 0.004, 6, 120)), ringMat3);

            rootGroup.add(ring1, ring2, ring3);

            // Central pulsing core mesh
            const coreGeo = register(new THREE.SphereGeometry(0.24, 16, 16));
            const coreMat = register(new THREE.MeshBasicMaterial({
                color: 0x3b82f6,
                transparent: true,
                opacity: 0.84,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            const core = new THREE.Mesh(coreGeo, coreMat);
            rootGroup.add(core);

            // Outer soft glow mesh
            const glowGeo = register(new THREE.SphereGeometry(0.48, 16, 16));
            const glowMat = register(new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                transparent: true,
                opacity: 0.34,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            const glow = new THREE.Mesh(glowGeo, glowMat);
            rootGroup.add(glow);

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;

                // Responsive positioning (center for tablet/desktop, shift slightly on mobile)
                if (width < 640) {
                    rootGroup.position.set(0, 0.2, -0.5);
                    rootGroup.scale.setScalar(0.72);
                } else if (width < 1024) {
                    rootGroup.position.set(1.4, -0.1, -0.6);
                    rootGroup.scale.setScalar(0.9);
                } else {
                    rootGroup.position.set(2.2, -0.2, -0.8);
                    rootGroup.scale.setScalar(1.15);
                }

                camera.updateProjectionMatrix();
            };

            resize();
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);

            teardownScene = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                resizeObserver?.disconnect();
                visibilityObserver?.disconnect();
                disposables.forEach((d) => d.dispose());
                renderer.dispose();
            };

            const clock = new THREE.Clock();

            const renderFrame = () => {
                frameId = 0;
                const elapsed = clock.getElapsedTime();

                // Rotate rings on multiple axes
                ring1.rotation.x = elapsed * 0.24;
                ring1.rotation.y = elapsed * 0.32;

                ring2.rotation.y = -elapsed * 0.4;
                ring2.rotation.z = elapsed * 0.18;

                ring3.rotation.x = -elapsed * 0.13;
                ring3.rotation.z = -elapsed * 0.26;

                // Pulsing animation for the central core & glow
                if (!reducedMotion) {
                    const pulse = 1.0 + Math.sin(elapsed * 3.1) * 0.18;
                    core.scale.setScalar(pulse);

                    const glowPulse = 1.0 + Math.sin(elapsed * 3.1 + Math.PI) * 0.28;
                    glow.scale.setScalar(glowPulse);
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
            }, { threshold: 0.05 });
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
    }, [seed]);

    return (
        <div ref={containerRef} className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}>
            <canvas ref={canvasRef} className="w-full h-full block opacity-65" />
        </div>
    );
};

import React, { useEffect, useRef } from 'react';
import type { BufferAttribute, Mesh, MeshPhysicalMaterial, PointsMaterial, Group } from 'three';

type PricingThreeFieldProps = {
    className?: string;
    seed?: number;
    variant?: 'hero' | 'sparse' | 'icosahedron';
    layout?: 'pricing' | 'wizard' | 'center';
};

type ParticleState = {
    x: number;
    y: number;
    z: number;
    drift: number;
    phase: number;
    speed: number;
};

const createSeededRandom = (seed: number) => {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;

    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
};

export const PricingThreeField: React.FC<PricingThreeFieldProps> = ({
    className = '',
    seed = 42,
    variant = 'hero',
    layout = 'pricing',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isIcosahedron = variant === 'icosahedron' || layout === 'wizard';
    const isHero = variant === 'hero' && !isIcosahedron;

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
                    gradient.addColorStop(0.2, 'rgba(156,163,175,0.8)');
                    gradient.addColorStop(0.5, 'rgba(59,130,246,0.2)');
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
            scene.add(new THREE.AmbientLight(0xf0f7ff, isHero ? 3.2 : 2.0));

            // Floating neon point lights to illuminate the metallic ribbon
            const cyanLight = new THREE.PointLight(0x38bdf8, isHero ? 18 : 8, 20);
            scene.add(cyanLight);

            const purpleLight = new THREE.PointLight(0xa78bfa, isHero ? 14 : 6, 18);
            scene.add(purpleLight);

            const magentaLight = new THREE.PointLight(0xf472b6, isHero ? 12 : 5, 16);
            scene.add(magentaLight);

            // Add a directional light for specular highlights
            const dirLight = new THREE.DirectionalLight(0xffffff, isHero ? 2.5 : 1.0);
            dirLight.position.set(5, 5, 4);
            scene.add(dirLight);

            const root = new THREE.Group();
            root.position.set(0, 0, 0);
            scene.add(root);

            // Create background stars/particles
            const starCount = isHero ? 200 : 70;
            const starPositions = new Float32Array(starCount * 3);
            const starColors = new Float32Array(starCount * 3);
            const starSizes = new Float32Array(starCount);
            const starStates: ParticleState[] = [];
            const starPalette = [0x60a5fa, 0x38bdf8, 0xa78bfa, 0xf472b6, 0xffffff];

            for (let i = 0; i < starCount; i++) {
                const x = (random() - 0.5) * 16.0;
                const y = (random() - 0.5) * 10.0;
                const z = -2.0 - random() * 4.0;

                const color = new THREE.Color(starPalette[Math.floor(random() * starPalette.length)]);
                const brightness = 0.4 + random() * 0.6;

                starPositions[i * 3] = x;
                starPositions[i * 3 + 1] = y;
                starPositions[i * 3 + 2] = z;
                starColors[i * 3] = color.r * brightness;
                starColors[i * 3 + 1] = color.g * brightness;
                starColors[i * 3 + 2] = color.b * brightness;
                starSizes[i] = random() * 0.08 + 0.03;

                starStates.push({
                    x,
                    y,
                    z,
                    drift: 0.02 + random() * 0.05,
                    phase: random() * Math.PI * 2,
                    speed: 0.15 + random() * 0.25,
                });
            }

            const starGeometry = register(new THREE.BufferGeometry());
            starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
            starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
            starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

            const starMaterial = register(new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: particleTexture },
                    opacity: { value: isHero ? 0.45 : 0.3 },
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
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));

            const stars = new THREE.Points(starGeometry, starMaterial);
            root.add(stars);

            let knotMesh: Mesh | null = null;
            let ring1: Mesh | null = null;
            let ring2: Mesh | null = null;

            if (isHero || isIcosahedron) {
                 // Create the main abstract 3D shape
                 const knotGeometry = isIcosahedron
                     ? register(new THREE.IcosahedronGeometry(1.4, 0)) // Faceted glass gem!
                     : register(new THREE.TorusKnotGeometry(1.6, 0.45, 280, 24, 2, 3));

                 const knotMaterial = register(new THREE.MeshPhysicalMaterial({
                     color: isIcosahedron ? 0x6366f1 : 0x38bdf8, // Indigo for gem, cyan/sky-blue for torus knot
                     metalness: isIcosahedron ? 0.05 : 0.2, // Lower metalness for clear crystal glass
                     roughness: 0.05, // Glossy surface
                     clearcoat: 1.0,
                     clearcoatRoughness: 0.05,
                     transmission: 0.8, // More transparent and glassy
                     thickness: 1.5, // Deeper refraction
                     ior: 1.55,
                     transparent: true,
                     opacity: 0.9,
                     depthWrite: isIcosahedron ? true : false,
                 }));

                 knotMesh = new THREE.Mesh(knotGeometry, knotMaterial);
                 root.add(knotMesh);

                 // Add a holographic glowing wireframe overlay for sharp faceted outlines
                 const wireframeMaterial = register(new THREE.MeshBasicMaterial({
                     color: isIcosahedron ? 0x818cf8 : 0x38bdf8, // Indigo glow or cyan glow
                     wireframe: true,
                     transparent: true,
                     opacity: isIcosahedron ? 0.35 : 0.18,
                     blending: THREE.AdditiveBlending,
                     depthWrite: false,
                 }));
                 
                 const wireframeMesh = new THREE.Mesh(knotGeometry, wireframeMaterial);
                 wireframeMesh.scale.setScalar(1.002);
                 knotMesh.add(wireframeMesh);

                 // Add thin glowing wireframe orbit rings for extra detail
                 const ringMaterial = register(new THREE.MeshBasicMaterial({
                     color: isIcosahedron ? 0x6366f1 : 0x38bdf8,
                     wireframe: true,
                     transparent: true,
                     opacity: 0.18,
                     blending: THREE.AdditiveBlending,
                     depthWrite: false,
                 }));

                 ring1 = new THREE.Mesh(register(new THREE.TorusGeometry(2.8, 0.008, 6, 120)), ringMaterial);
                 ring1.rotation.x = Math.PI / 3;
                 root.add(ring1);

                 ring2 = new THREE.Mesh(register(new THREE.TorusGeometry(3.1, 0.006, 6, 120)), ringMaterial);
                 ring2.rotation.y = Math.PI / 4;
                 ring2.rotation.x = -Math.PI / 6;
                 root.add(ring2);
             }

            const resize = () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;

                // Adjust camera position based on screen width and layout
                if (layout === 'wizard') {
                    if (width < 640) {
                        camera.position.z = 10.0;
                        root.position.set(0, 0.6, 0); // Position it slightly higher on mobile
                        root.scale.setScalar(0.7);
                    } else if (width < 1024) {
                        camera.position.z = 9.0;
                        root.position.set(0, 0.15, 0);
                        root.scale.setScalar(0.85);
                    } else {
                        camera.position.z = 8.5;
                        root.position.set(0, -0.05, 0);
                        root.scale.setScalar(1.05);
                    }
                } else if (layout === 'center') {
                    if (width < 640) {
                        camera.position.z = 10.0;
                        root.position.set(0, 0, 0);
                        root.scale.setScalar(0.75);
                    } else {
                        camera.position.z = 8.5;
                        root.position.set(0, 0, 0);
                        root.scale.setScalar(1.1);
                    }
                } else {
                    // default 'pricing'
                    if (width < 640) {
                        camera.position.z = 10.0;
                        root.position.set(0, 0.8, 0); // Position it slightly higher on mobile
                        root.scale.setScalar(0.75);
                    } else if (width < 1024) {
                        camera.position.z = 9.0;
                        root.position.set(0.8, 0.2, 0);
                        root.scale.setScalar(0.9);
                    } else {
                        camera.position.z = 8.5;
                        // Push the 3D model to the right side on desktop, matching Amplitude's visual layout
                        root.position.set(1.8, 0.1, 0);
                        root.scale.setScalar(1.1);
                    }
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
            let lastTime = 0;

            const renderFrame = () => {
                frameId = 0;
                const elapsed = reducedMotion ? 2.5 : clock.getElapsedTime();
                const totalTime = clock.getElapsedTime();
                const dt = Math.min(0.034, totalTime - lastTime);
                lastTime = totalTime;

                // Rotate knot and background groups
                 if ((isHero || isIcosahedron) && knotMesh && ring1 && ring2) {
                     knotMesh.rotation.x = elapsed * 0.15;
                     knotMesh.rotation.y = elapsed * 0.2;
                     knotMesh.rotation.z = elapsed * 0.08;

                     ring1.rotation.z = -elapsed * 0.12;
                     ring2.rotation.z = elapsed * 0.08;
                 }

                root.rotation.y = Math.sin(elapsed * 0.1) * 0.05;

                // Orbit point lights around the knot to sweep reflections across the metallic surface
                const lightTime1 = elapsed * 0.6;
                cyanLight.position.x = Math.sin(lightTime1) * 3.2;
                cyanLight.position.z = Math.cos(lightTime1) * 3.2;
                cyanLight.position.y = Math.sin(lightTime1 * 0.5) * 1.5;

                const lightTime2 = elapsed * 0.4 + 2.0;
                purpleLight.position.y = Math.sin(lightTime2) * 3.0;
                purpleLight.position.z = Math.cos(lightTime2) * 3.0;
                purpleLight.position.x = Math.cos(lightTime2 * 0.7) * 1.8;

                const lightTime3 = elapsed * 0.5 + 4.0;
                magentaLight.position.x = Math.cos(lightTime3) * 3.5;
                magentaLight.position.y = Math.sin(lightTime3) * 3.5;
                magentaLight.position.z = Math.sin(lightTime3 * 0.8) * 2.0;

                // Animate background particles
                const starPosAttr = starGeometry.getAttribute('position') as BufferAttribute;
                for (let i = 0; i < starCount; i++) {
                    const star = starStates[i];
                    const driftX = Math.sin(elapsed * star.speed + star.phase) * star.drift;
                    const driftY = Math.cos(elapsed * star.speed * 0.8 + star.phase) * star.drift;
                    starPosAttr.setXYZ(i, star.x + driftX, star.y + driftY, star.z);
                }
                starPosAttr.needsUpdate = true;

                 // Dynamic scale pulsing on the knot to make it feel organic and alive
                 if ((isHero || isIcosahedron) && knotMesh && !reducedMotion) {
                     const scalePulse = 1.0 + Math.sin(elapsed * 0.8) * 0.03;
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
    }, [seed, variant, layout]);

    const canvasStyle: React.CSSProperties = {
        height: isHero ? 'max(140%, 1020px)' : '100%',
        left: '50%',
        maxWidth: 'none',
        top: isHero ? '48%' : '50%',
        transform: 'translate3d(-50%, -50%, 0)',
        width: isHero ? 'max(145vw, 1580px)' : '100%',
    };

    return (
        <div
            className={`pointer-events-none absolute inset-0 z-[1] overflow-visible ${className}`}
            aria-hidden="true"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                        @keyframes pricingHazeDrift {
                            0% { transform: translate3d(-2%, -1.5%, 0) scale(1); opacity: 0.35; }
                            100% { transform: translate3d(2%, 1.5%, 0) scale(1.03); opacity: 0.55; }
                        }
                        .pricing-light-bg {
                            position: absolute;
                            inset: 0;
                            background:
                                radial-gradient(circle at 80% 25%, rgba(125, 211, 252, 0.35), transparent 45%),
                                radial-gradient(circle at 20% 65%, rgba(196, 181, 253, 0.38), transparent 40%),
                                radial-gradient(circle at 50% 10%, rgba(13, 148, 136, 0.06), transparent 35%),
                                linear-gradient(180deg, #f8fbff 0%, #f3f8fc 60%, #ffffff 100%);
                        }
                        .pricing-light-haze {
                            position: absolute;
                            inset: -12% -15%;
                            background:
                                radial-gradient(ellipse at 75% 30%, rgba(125, 211, 252, 0.25), transparent 45%),
                                radial-gradient(ellipse at 25% 60%, rgba(196, 181, 253, 0.22), transparent 42%),
                                radial-gradient(ellipse at 50% 85%, rgba(244, 114, 182, 0.08), transparent 38%);
                            filter: blur(45px);
                            animation: pricingHazeDrift 22s ease-in-out infinite alternate;
                        }
                        .pricing-three-canvas {
                            opacity: ${isHero ? '0.65' : '0.4'};
                        }
                        .dark .pricing-light-bg {
                            background:
                                radial-gradient(circle at 80% 25%, rgba(99, 102, 241, 0.15), transparent 45%),
                                radial-gradient(circle at 20% 65%, rgba(168, 85, 247, 0.15), transparent 40%),
                                radial-gradient(circle at 50% 10%, rgba(20, 184, 166, 0.04), transparent 35%),
                                linear-gradient(180deg, #030712 0%, #0b0f19 60%, #030712 100%);
                        }
                        .dark .pricing-light-haze {
                            background:
                                radial-gradient(ellipse at 75% 30%, rgba(99, 102, 241, 0.12), transparent 45%),
                                radial-gradient(ellipse at 25% 60%, rgba(168, 85, 247, 0.1), transparent 42%),
                                radial-gradient(ellipse at 50% 85%, rgba(244, 114, 182, 0.04), transparent 38%);
                            filter: blur(45px);
                        }
                        @media (max-width: 640px) {
                            .pricing-three-canvas {
                                opacity: ${isHero ? '0.45' : '0.25'};
                            }
                        }
                        @media (prefers-reduced-motion: reduce) {
                            .pricing-light-haze {
                                animation: none;
                            }
                        }
                    `,
                }}
            />
            <div className="pricing-light-bg" />
            <div className="pricing-light-haze" />
            <canvas
                ref={canvasRef}
                className="pricing-three-canvas absolute"
                style={canvasStyle}
            />
        </div>
    );
};

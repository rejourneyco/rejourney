<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Logotipo de Rejourney" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Detección de problemas de Rejourney" width="100%" />

  <p>
    <strong>Detección de fugas de embudo con IA y aceleración de conversión</strong>
    <br />
    Corrige fugas de embudo y conversión con Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Explorar el sitio web »</strong></a>
  </p>

  <p>
    <a href="https://reactnative.dev">
      <img src="https://img.shields.io/badge/React%20Native-20232A?style=for-the-badge&amp;logo=react&amp;logoColor=61DAFB" alt="React Native" />
    </a>
    <a href="https://expo.dev">
      <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&amp;logo=expo&amp;logoColor=white" alt="Expo" />
    </a>
    <a href="https://www.swift.org">
      <img src="https://img.shields.io/badge/Swift-F05138?style=for-the-badge&amp;logo=swift&amp;logoColor=white" alt="Swift" />
    </a>
  </p>

  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript">
      <img src="https://img.shields.io/badge/Browser%20SDK-F7DF1E?style=for-the-badge&amp;logo=javascript&amp;logoColor=black" alt="Browser SDK" />
    </a>
    <a href="https://nextjs.org">
      <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&amp;logo=nextdotjs&amp;logoColor=white" alt="Next.js" />
    </a>
    <a href="https://vuejs.org">
      <img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&amp;logo=vuedotjs&amp;logoColor=white" alt="Vue.js" />
    </a>
    <a href="https://nuxt.com">
      <img src="https://img.shields.io/badge/Nuxt-00DC82?style=for-the-badge&amp;logo=nuxt&amp;logoColor=white" alt="Nuxt" />
    </a>
  </p>
</div>

## Funciones

### Captura Pixel Perfect
![Teatro de reproducción de sesiones](../dashboard/web-ui/public/images/session-replay-preview.png)

Reproducción de video a FPS reales que captura cada píxel renderizado. A diferencia de la competencia, capturamos todo, incluido Mapbox (Metal), shaders personalizados y vistas aceleradas por GPU.

### Detección de fugas con IA
![Feed de problemas](../dashboard/web-ui/public/images/readme-general-demo.png)

Clasifica fugas repetidas de embudo, rage taps, fallos de API y evidencia de replay en paquetes de contexto listos para corregir. Impulsado por Rejourney Marlin.

### Detección de errores, ANR y bloqueos
![Problemas ANR](../dashboard/web-ui/public/images/anr-issues.png)

Detección automática de eventos de aplicación que no responde, con volcados completos de hilos y análisis del hilo principal.

### Mapeo de recorridos
![Recorridos de usuario](../dashboard/web-ui/public/images/readme-user-journeys.png)

Visualiza cómo navegan los usuarios por tu app. Identifica puntos de abandono de alta fricción y optimiza los embudos de conversión.

### Mapas de calor de interacción
![Mapas de calor](../dashboard/web-ui/public/images/heatmaps.png)

**Visualiza la interacción del usuario con precisión.** Mira dónde tocan, deslizan y hacen scroll para optimizar la ubicación de la interfaz.

### Estabilidad global
![Analítica geográfica](../dashboard/web-ui/public/images/geo-analytics.png)

Supervisa rendimiento y estabilidad en distintas regiones. Detecta problemas de infraestructura antes de que afecten a tu audiencia global.

### Motores de crecimiento
![Motores de crecimiento](../dashboard/web-ui/public/images/growth-engines.png)
Rastrea la retención de usuarios y los segmentos de lealtad. Entiende cómo los lanzamientos impactan a tus usuarios avanzados frente a las tasas de rebote.

## Documentación

Guías completas de integración y referencia de API: https://rejourney.co/docs/reactnative/overview

## Contribuir

¿Quieres contribuir a Rejourney? Consulta nuestra guía de contribución: https://rejourney.co/docs/community/contributing

## Desarrollo local

El desarrollo local replica producción mediante [`local-k8s/`](../local-k8s). En un checkout nuevo, copia `local-k8s/env.example` a `.env.k8s.local`, completa los secretos locales requeridos y ejecuta `npm run ci:local` para instalar, validar, compilar, desplegar, migrar e iniciar el stack local. Después del primer bootstrap, usa `npm run dev` para el flujo diario con hot reload.

`docker-compose.selfhosted.yml` es la ruta oficial de despliegue self-hosted de un solo nodo.

## Benchmarks

Rejourney está diseñado para no estorbar: paquete pequeño, baja intensidad en el navegador y captura móvil que mantiene libre el hilo principal. La galería de benchmarks de la landing está enlazada directamente en [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### Web vs PostHog

Benchmark en Chromium real sobre tres fixtures web: Next.js, SvelteKit y Nuxt. Cada SDK se ejecutó contra un endpoint de proyecto en vivo durante 3 iteraciones por framework. Menor es mejor en todas las métricas.

**Evidencia:** [informe de benchmark](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [resultados sin procesar](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [capturas de red en vivo de Rejourney](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [capturas de red de PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Sección | Ganador | Margen |
| :--- | :---: | :--- |
| Tamaño gzipped del paquete en Bundlephobia | Rejourney | **3.9x más pequeño** que `posthog-js` |
| Mediana del cuerpo de carga del SDK en vivo | Rejourney | **3.0x más pequeño** que PostHog |
| Duración de tareas del navegador | Rejourney | **1.1x menor** en mediana |
| Tiempo de ejecución de scripts | Rejourney | **2.0x menor** en mediana |
| Heap JS final | Rejourney | **1.4x menor** en mediana |

#### Tamaño de paquete

Tamaño de paquete con versión fija en Bundlephobia. Gzip es el segmento de transferencia; minified es la barra completa representada en la galería.

| Paquete | Versión | Minified | Gzipped | Fuente |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Métricas del benchmark web en vivo

| App | Carga Rejourney | Carga PostHog | Tarea Rejourney | Tarea PostHog | Script Rejourney | Script PostHog | Heap Rejourney | Heap PostHog |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile usa una canalización de captura asíncrona con run loop gating, por lo que el trabajo de captura puede ejecutarse fuera de la ruta crítica de renderizado de la app y pausarse automáticamente durante periodos de alta interacción.

#### Tamaño del paquete React Native

| Paquete | Versión | Minified | Gzipped | Ganador |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **bundle JS minificado 10.2x más pequeño** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Fuentes: [`@rejourneyco/react-native` en Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` en Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Rendimiento móvil

**Dispositivo:** iPhone 15 Pro (iOS 26)
**Entorno:** Expo SDK 54, React Native New Architecture
**App de prueba:** [Merch App](https://merchcampus.com) build de producción con Mapbox Metal y Firebase
**Carga de prueba:** 46 elementos complejos de feed, vista Mapbox GL, 124 llamadas API, 31 subcomponentes, seguimiento activo de gestos y redacción de privacidad en tiempo real.

| Métrica | Prom. (ms) | Máx. (ms) | Mín. (ms) | Hilo |
| :--- | ---: | ---: | ---: | :---: |
| **Principal: captura UIKit + Metal** | **12.4** | 28.2 | 8.1 | Principal |
| **BG: procesamiento asíncrono de imágenes** | 42.5 | 88.0 | 32.4 | Background |
| **BG: compresión Tar+Gzip** | 14.2 | 32.5 | 9.6 | Background |
| **BG: handshake de carga** | 0.8 | 2.4 | 0.3 | Background |
| **Impacto total en el hilo principal** | **12.4** | 28.2 | 8.1 | Principal |

El impacto total en el hilo principal es el único trabajo de esta tabla que bloquea el renderizado de la app.

## Ingeniería

Decisiones de ingeniería y arquitectura: https://rejourney.co/engineering

## Licencia

Los componentes del lado del cliente (SDKs, CLIs) tienen licencia Apache 2.0. Los componentes del lado del servidor (backend, dashboard) tienen licencia SSPL 1.0. Consulta [LICENSE-APACHE](../LICENSE-APACHE) y [LICENSE-SSPL](../LICENSE-SSPL) para más detalles.

---

## Traducciones

- [Árabe | العربية](README_AR.md)
- [Chino simplificado | 简体中文](README_ZH_CN.md)
- [Francés | Français](README_FR.md)
- [Alemán | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonesio | Bahasa Indonesia](README_ID.md)
- [Japonés | 日本語](README_JA.md)
- [Coreano | 한국어](README_KO.md)
- [Portugués de Brasil | Português do Brasil](README_PT_BR.md)
- [Español | Español](README_ES.md)
- [Turco | Türkçe](README_TR.md)

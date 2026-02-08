<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="https://rejourney.co/images/session-replay-preview.png" alt="Rejourney Session Replay" width="100%" />

  <p>
    <strong>Reproducción de sesiones y observabilidad ligera para React Native</strong>
    <br />
    Enfoque primero en dispositivos móviles con captura de video pixel-perfect y detección de incidentes en tiempo real.
  </p>
  
  <p>
    <a href="https://rejourney.co"><strong>Explorar el sitio web »</strong></a>
  </p>
  
  <p>
    <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-61DAFB?logo=react&logoColor=black" alt="React Native" /></a>
    <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo" /></a>
  </p>
</div>

## Características

### Captura Pixel Perfect
Reproducción de video a FPS reales capturando cada píxel renderizado. A diferencia de la competencia, capturamos todo—incluyendo Mapbox (Metal), shaders personalizados y vistas aceleradas por GPU.

### Flujo de Incidentes en Vivo
![Canal de Problemas](https://rejourney.co/images/issues-feed.png)

Vea bloqueos, errores y "rage taps" a medida que ocurren en tiempo real con informes de errores instantáneos.

### Detección de Errores/ANR/Bloqueos
![Problemas de ANR](https://rejourney.co/images/anr-issues.png)

Detección automática de eventos "La aplicación no responde" (ANR) con volcados de hilos completos y análisis del hilo principal.

### Mapeo de Trayectos (Journey Mapping)
![Trayectos de Usuario](https://rejourney.co/images/user-journeys.png)

Visualice cómo navegan los usuarios por su aplicación. Identifique puntos de abandono con alta fricción y optimice los embudos de conversión.

### Mapas de Calor de Interacción
![Mapas de Calor](https://rejourney.co/heatmaps-demo.png)

**Visualice el compromiso del usuario con precisión.** Vea dónde pulsan, deslizan y hacen scroll para optimizar la ubicación de la interfaz de usuario.

### Estabilidad Global
![Inteligencia Geográfica](https://rejourney.co/images/geo-intelligence.png)

Monitoree el rendimiento y la estabilidad en diferentes regiones. Identifique problemas de infraestructura antes de que afecten a su audiencia global.

### Motores de Crecimiento
![Motores de Crecimiento](https://rejourney.co/images/growth-engines.png)
Rastree la retención de usuarios y los segmentos de lealtad. Entienda cómo impactan los lanzamientos a sus usuarios avanzados frente a las tasas de rebote.

### Alertas de Equipo
![Alertas de Equipo](https://rejourney.co/images/team-alerts.png)
Notificaciones inteligentes por correo electrónico para bloqueos, ANRs y picos de errores. Acceso basado en roles para equipos de ingeniería.

## Documentación

Guías de integración completas y referencia de API: https://rejourney.co/docs/reactnative/overview

### Autohospedaje

- Autohospedaje con un solo archivo Docker: https://rejourney.co/docs/selfhosted
- Hospedaje K3s de nivel empresarial (documentación de arquitectura): https://rejourney.co/docs/architecture/distributed-vs-single-node

## Contribución

¿Quiere contribuir a Rejourney? Consulte nuestra Guía de contribución: https://rejourney.co/docs/community/contributing

## Benchmarks (Pruebas de Rendimiento)

Rejourney está diseñado para ser **invisible al ojo**. Utilizamos un **Pipeline de Captura Asíncrono** combinado con **Gating del Ciclo de Ejecución (Run Loop Gating)**, asegurando que el SDK se pause automáticamente durante las interacciones (toques/scrolls) para mantener un 100% de capacidad de respuesta de la interfaz de usuario.

**Dispositivo:** iPhone 15 Pro (iOS 18)  
**Entorno:** Expo SDK 54, React Native New Architecture (Concurrent Mode)  
**App de Prueba:** [Merch App](https://merchcampus.com) (Versión de producción con Mapbox Metal + Firebase)  
**Carga de Trabajo:** 46 elementos de feed complejos, vista Mapbox GL, 124 llamadas a API, 31 subcomponentes, seguimiento de gestos activo y redacción de privacidad en tiempo real.

| Métrica | Promedio (ms) | Máximo (ms) | Mínimo (ms) | Hilo |
| :--- | :---: | :---: | :---: | :---: |
| **Principal: Captura UIKit + Metal** | **12.4** | 28.2 | 8.1 | Principal |
| **Segundo Plano: Proc. de Imagen Asíncrono** | 42.5 | 88.0 | 32.4 | Segundo Plano |
| **Segundo Plano: Compresión Tar+Gzip** | 14.2 | 32.5 | 9.6 | Segundo Plano |
| **Segundo Plano: Handshake de Carga** | 0.8 | 2.4 | 0.3 | Segundo Plano |
| **Impacto Total en el Hilo Principal** | **12.4** | 28.2 | 8.1 | Principal |

*Nota: El impacto total en el hilo principal es el único trabajo que bloquea el renderizado de su aplicación.*

## Ingeniería

Decisiones de ingeniería y arquitectura: https://rejourney.co/engineering

## Licencia

Los componentes del lado del cliente (SDKs, CLIs) están licenciados bajo Apache 2.0. Los componentes del lado del servidor (backend, dashboard) están licenciados bajo SSPL 1.0. Consulte [LICENSE-APACHE](LICENSE-APACHE) y [LICENSE-SSPL](LICENSE-SSPL) para más detalles.

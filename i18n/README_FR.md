<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Logo Rejourney" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Détection de problèmes Rejourney" width="100%" />

  <p>
    <strong>Détection IA des fuites de tunnel et accélération de conversion</strong>
    <br />
    Corrigez les fuites de tunnel et de conversion avec Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Explorer le site »</strong></a>
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

## Fonctionnalités

### Capture pixel perfect
![Théâtre de replay de session](../dashboard/web-ui/public/images/session-replay-preview.png)

Lecture vidéo en FPS réels qui capture chaque pixel rendu. Contrairement aux concurrents, nous capturons tout, y compris Mapbox (Metal), les shaders personnalisés et les vues accélérées par GPU.

### Détection IA des fuites
![Flux de problèmes](../dashboard/web-ui/public/images/readme-general-demo.png)

Classe les fuites récurrentes de tunnel, les rage taps, les échecs d'API et les preuves de replay en paquets de contexte prêts à corriger. Propulsé par Rejourney Marlin.

### Détection d'erreurs, d'ANR et de crashs
![Problèmes ANR](../dashboard/web-ui/public/images/anr-issues.png)

Détection automatique des événements Application Not Responding avec dumps complets des threads et analyse du thread principal.

### Cartographie des parcours
![Parcours utilisateur](../dashboard/web-ui/public/images/readme-user-journeys.png)

Visualisez la façon dont les utilisateurs parcourent votre app. Identifiez les points d'abandon à forte friction et optimisez les tunnels de conversion.

### Heatmaps d'interaction
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**Visualisez l'engagement utilisateur avec précision.** Voyez où les utilisateurs touchent, balayent et font défiler pour optimiser le placement de l'interface.

### Stabilité mondiale
![Analyse géographique](../dashboard/web-ui/public/images/geo-analytics.png)

Surveillez les performances et la stabilité par région. Repérez les problèmes d'infrastructure avant qu'ils touchent votre audience mondiale.

### Moteurs de croissance
![Moteurs de croissance](../dashboard/web-ui/public/images/growth-engines.png)
Suivez la rétention utilisateur et les segments de fidélité. Comprenez comment les releases affectent vos power users par rapport aux taux de rebond.

## Documentation

Guides d'intégration complets et référence API : https://rejourney.co/docs/reactnative/overview

## Contribuer

Vous voulez contribuer à Rejourney ? Consultez notre guide de contribution : https://rejourney.co/docs/community/contributing

## Développement local

Le développement local reflète la production via [`local-k8s/`](../local-k8s). Pour un nouveau checkout, copiez `local-k8s/env.example` vers `.env.k8s.local`, renseignez les secrets locaux requis, puis exécutez `npm run ci:local` pour installer, valider, compiler, déployer, migrer et démarrer la stack locale. Après ce premier bootstrap, utilisez `npm run dev` pour le flux quotidien avec hot reload.

`docker-compose.selfhosted.yml` est le chemin officiel de déploiement self-hosted sur un seul noeud.

## Benchmarks

Rejourney est conçu pour rester discret : faible empreinte de paquet, faible intensité navigateur et capture mobile qui garde le thread principal dégagé. La galerie de benchmarks de la landing page est accessible directement sur [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### Web vs PostHog

Benchmark Chromium réel sur trois fixtures web : Next.js, SvelteKit et Nuxt. Chaque SDK a été exécuté contre un endpoint de projet live pendant 3 itérations par framework. Plus bas est meilleur pour toutes les métriques.

**Preuves :** [rapport de benchmark](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [résultats bruts](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [captures réseau live de Rejourney](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [captures réseau PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Section | Gagnant | Marge |
| :--- | :---: | :--- |
| Taille gzippée du paquet Bundlephobia | Rejourney | **3.9x plus petit** que `posthog-js` |
| Corps médian d'upload SDK live | Rejourney | **3.0x plus petit** que PostHog |
| Durée des tâches navigateur | Rejourney | **1.1x plus faible** en médiane |
| Temps d'exécution des scripts | Rejourney | **2.0x plus faible** en médiane |
| Heap JS final | Rejourney | **1.4x plus faible** en médiane |

#### Taille du paquet

Taille de paquet Bundlephobia à version fixe. Gzip est le segment de taille de transfert ; minified est la barre complète représentée dans la galerie.

| Paquet | Version | Minified | Gzipped | Source |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Métriques du benchmark web live

| App | Upload Rejourney | Upload PostHog | Tâche Rejourney | Tâche PostHog | Script Rejourney | Script PostHog | Heap Rejourney | Heap PostHog |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile utilise une pipeline de capture asynchrone avec run loop gating, afin que la capture se fasse hors du chemin critique de rendu de l'app et se mette automatiquement en pause pendant les périodes de forte interaction.

#### Taille du paquet React Native

| Paquet | Version | Minified | Gzipped | Gagnant |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **bundle JS minifié 10.2x plus petit** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Sources : [`@rejourneyco/react-native` sur Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` sur Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Performance mobile

**Appareil :** iPhone 15 Pro (iOS 26)
**Environnement :** Expo SDK 54, React Native New Architecture
**App de test :** [Merch App](https://merchcampus.com) build de production avec Mapbox Metal et Firebase
**Charge de test :** 46 éléments de feed complexes, vue Mapbox GL, 124 appels API, 31 sous-composants, suivi actif des gestes et rédaction de confidentialité en temps réel.

| Métrique | Moy. (ms) | Max (ms) | Min (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main : capture UIKit + Metal** | **12.4** | 28.2 | 8.1 | Main |
| **BG : traitement d'image asynchrone** | 42.5 | 88.0 | 32.4 | Background |
| **BG : compression Tar+Gzip** | 14.2 | 32.5 | 9.6 | Background |
| **BG : handshake d'upload** | 0.8 | 2.4 | 0.3 | Background |
| **Impact total sur le thread principal** | **12.4** | 28.2 | 8.1 | Main |

L'impact total sur le thread principal est le seul travail de ce tableau qui bloque le rendu de l'app.

## Ingénierie

Décisions d'ingénierie et architecture : https://rejourney.co/engineering

## Licence

Les composants côté client (SDKs, CLIs) sont sous licence Apache 2.0. Les composants côté serveur (backend, dashboard) sont sous licence SSPL 1.0. Voir [LICENSE-APACHE](../LICENSE-APACHE) et [LICENSE-SSPL](../LICENSE-SSPL) pour plus de détails.

---

## Traductions

- [Arabe | العربية](README_AR.md)
- [Chinois simplifié | 简体中文](README_ZH_CN.md)
- [Français | Français](README_FR.md)
- [Allemand | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonésien | Bahasa Indonesia](README_ID.md)
- [Japonais | 日本語](README_JA.md)
- [Coréen | 한국어](README_KO.md)
- [Portugais (Brésil) | Português do Brasil](README_PT_BR.md)
- [Espagnol | Español](README_ES.md)
- [Turc | Türkçe](README_TR.md)

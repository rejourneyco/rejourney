<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Logo da Rejourney" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Detecção de problemas da Rejourney" width="100%" />

  <p>
    <strong>Detecção de vazamentos de funil com IA e aceleração de conversão</strong>
    <br />
    Corrija vazamentos de funil e conversão com a Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Explorar o site »</strong></a>
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

## Recursos

### Captura pixel perfect
![Teatro de replay de sessão](../dashboard/web-ui/public/images/session-replay-preview.png)

Reprodução de vídeo em FPS real capturando cada pixel renderizado. Diferente dos concorrentes, capturamos tudo, incluindo Mapbox (Metal), shaders personalizados e views aceleradas por GPU.

### Detecção de vazamentos com IA
![Feed de problemas](../dashboard/web-ui/public/images/readme-general-demo.png)

Classifica vazamentos recorrentes de funil, rage taps, falhas de API e evidências de replay em pacotes de contexto prontos para correção. Com tecnologia Rejourney Marlin.

### Detecção de erros, ANR e crashes
![Problemas ANR](../dashboard/web-ui/public/images/anr-issues.png)

Detecção automática de eventos Application Not Responding com dumps completos de threads e análise da thread principal.

### Mapeamento de jornadas
![Jornadas de usuário](../dashboard/web-ui/public/images/readme-user-journeys.png)

Visualize como os usuários navegam pelo seu app. Identifique pontos de abandono com alta fricção e otimize funis de conversão.

### Mapas de calor de interação
![Mapas de calor](../dashboard/web-ui/public/images/heatmaps.png)

**Visualize o engajamento do usuário com precisão.** Veja onde eles tocam, deslizam e rolam para otimizar o posicionamento da interface.

### Estabilidade global
![Analytics geográfico](../dashboard/web-ui/public/images/geo-analytics.png)

Monitore desempenho e estabilidade em diferentes regiões. Identifique problemas de infraestrutura antes que afetem sua audiência global.

### Motores de crescimento
![Motores de crescimento](../dashboard/web-ui/public/images/growth-engines.png)
Acompanhe retenção de usuários e segmentos de lealdade. Entenda como releases impactam power users versus taxas de rejeição.

## Documentação

Guias completos de integração e referência de API: https://rejourney.co/docs/reactnative/overview

## Contribuindo

Quer contribuir para a Rejourney? Veja nosso guia de contribuição: https://rejourney.co/docs/community/contributing

## Desenvolvimento local

O desenvolvimento local espelha a produção por meio de [`local-k8s/`](../local-k8s). Em um checkout novo, copie `local-k8s/env.example` para `.env.k8s.local`, preencha os segredos locais obrigatórios e execute `npm run ci:local` para instalar, validar, compilar, implantar, migrar e iniciar a stack local. Depois desse primeiro bootstrap, use `npm run dev` para o fluxo diário com hot reload.

`docker-compose.selfhosted.yml` é o caminho oficial de implantação self-hosted em nó único.

## Benchmarks

A Rejourney foi projetada para ficar fora do caminho: pacote pequeno, baixa intensidade no navegador e captura mobile que mantém a thread principal livre. A galeria de benchmarks da landing page pode ser acessada diretamente em [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### Web vs PostHog

Benchmark Chromium ao vivo nos três fixtures web: Next.js, SvelteKit e Nuxt. Cada SDK rodou contra um endpoint de projeto real por 3 iterações por framework. Menor é melhor para todas as métricas abaixo.

**Evidências:** [relatório de benchmark](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [resultados brutos](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [capturas de rede ao vivo da Rejourney](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [capturas de rede do PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Seção | Vencedor | Margem |
| :--- | :---: | :--- |
| Tamanho gzipped do pacote no Bundlephobia | Rejourney | **3.9x menor** que `posthog-js` |
| Mediana do corpo de upload do SDK ao vivo | Rejourney | **3.0x menor** que PostHog |
| Duração de tarefas do navegador | Rejourney | **1.1x menor** em tempo mediano de tarefa |
| Tempo de execução de scripts | Rejourney | **2.0x menor** em tempo mediano de script |
| Heap JS final | Rejourney | **1.4x menor** em heap mediano |

#### Tamanho do pacote

Tamanho de pacote em versão fixa no Bundlephobia. Gzip é o segmento de tamanho de transferência; minified é a barra completa representada na galeria.

| Pacote | Versão | Minified | Gzipped | Fonte |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Métricas do benchmark web ao vivo

| App | Upload Rejourney | Upload PostHog | Tarefa Rejourney | Tarefa PostHog | Script Rejourney | Script PostHog | Heap Rejourney | Heap PostHog |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile usa uma pipeline de captura assíncrona com run loop gating, então o trabalho de captura pode acontecer fora do caminho crítico de renderização do app e pausar automaticamente durante períodos de alta interação.

#### Tamanho do pacote React Native

| Pacote | Versão | Minified | Gzipped | Vencedor |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **bundle JS minificado 10.2x menor** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Fontes: [`@rejourneyco/react-native` no Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` no Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Performance mobile

**Dispositivo:** iPhone 15 Pro (iOS 26)
**Ambiente:** Expo SDK 54, React Native New Architecture
**App de teste:** [Merch App](https://merchcampus.com) build de produção com Mapbox Metal e Firebase
**Carga de teste:** 46 itens complexos de feed, Mapbox GL View, 124 chamadas de API, 31 subcomponentes, rastreamento ativo de gestos e redação de privacidade em tempo real.

| Métrica | Média (ms) | Máx. (ms) | Mín. (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main: captura UIKit + Metal** | **12.4** | 28.2 | 8.1 | Main |
| **BG: processamento assíncrono de imagem** | 42.5 | 88.0 | 32.4 | Background |
| **BG: compressão Tar+Gzip** | 14.2 | 32.5 | 9.6 | Background |
| **BG: handshake de upload** | 0.8 | 2.4 | 0.3 | Background |
| **Impacto total na thread principal** | **12.4** | 28.2 | 8.1 | Main |

O impacto total na thread principal é o único trabalho nesta tabela que bloqueia a renderização do app.

## Engenharia

Decisões de engenharia e arquitetura: https://rejourney.co/engineering

## Licença

Componentes do lado do cliente (SDKs, CLIs) são licenciados sob Apache 2.0. Componentes do lado do servidor (backend, dashboard) são licenciados sob SSPL 1.0. Veja [LICENSE-APACHE](../LICENSE-APACHE) e [LICENSE-SSPL](../LICENSE-SSPL) para detalhes.

---

## Traduções

- [Árabe | العربية](README_AR.md)
- [Chinês simplificado | 简体中文](README_ZH_CN.md)
- [Francês | Français](README_FR.md)
- [Alemão | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonésio | Bahasa Indonesia](README_ID.md)
- [Japonês | 日本語](README_JA.md)
- [Coreano | 한국어](README_KO.md)
- [Português (Brasil) | Português do Brasil](README_PT_BR.md)
- [Espanhol | Español](README_ES.md)
- [Turco | Türkçe](README_TR.md)

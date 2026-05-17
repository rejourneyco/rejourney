<!-- AI_PROMPT_SECTION -->
**Vous utilisez Cursor, Claude ou ChatGPT ?** Copiez l'invite d'intégration et collez-la dans votre assistant AI pour générer automatiquement le code de configuration.

<!-- /AI_PROMPT_SECTION -->

## Installation

Ajoutez le package Rejourney à votre projet à l'aide de npm ou yarn.

```bash
npm install @rejourneyco/browser
```

## Configuration de base

Initialisez et démarrez Rejourney au point d'entrée de votre application.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` récupère la configuration distante de votre projet et prépare le SDK. `start` démarre la session, enregistre le visiteur et (si la relecture est activée) démarre l'enregistreur rrweb. Les deux sont asynchrones et peuvent être appelés en toute sécurité sans attendre si vous n'avez pas besoin de déclencher quoi que ce soit à la fin.




> [!NOTE]
> `autoStart` est `false` par défaut. Vous devez appeler explicitement `start()`, ce qui vous permet de bloquer l'enregistrement derrière une vérification de consentement. Pour démarrer automatiquement après `init`, transmettez `{ autoStart: true }`.

### Intégrations de framework

Le package contient des points d’entrée dédiés aux frameworks populaires. Utilisez celui qui correspond à votre pile – ou utilisez le vanilla API ci-dessus à partir de n'importe quel framework.

---

#### Réagir

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` est par défaut `false` sur `RejourneyProvider`. Passez `startOnMount` (ou `startOnMount={true}`) pour démarrer l'enregistrement dès que le composant est monté.

---

#### Suivant.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` est un composant `'use client'` qui restitue `null`. `startOnMount` est par défaut `true`. Les changements d'itinéraire sont suivis automatiquement via l'historique API.

---

#### Vue

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

L'instance Rejourney est disponible via `app.config.globalProperties.$rejourney` et via `inject('rejourney')`. Le composable `useRejourney()` est également exporté pour plus de commodité.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Le suffixe `.client.ts` garantit que ce plugin s'exécute uniquement dans le navigateur. L'instance Rejourney est injectée sous le nom `$rejourney` et disponible via `useNuxtApp().$rejourney`.

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` renvoie une fonction de nettoyage qui appelle `Rejourney.stop()` — La valeur de retour `onMount` de Svelte est utilisée automatiquement comme rappel de destruction.

---

#### Angulaire

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` renvoie une usine qui initialise et démarre Rejourney pendant la phase d'amorçage d'Angular. Vous pouvez également injecter `RejourneyService` pour un API basé sur les classes.

---

#### Remixer

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

`startOnMount` est par défaut `true`. Les changements d'itinéraire sont suivis automatiquement.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` ne fonctionne pas dans les environnements SSR : il vérifie `window` avant de s'exécuter.

---

## Paramètres d'enregistrement à distance

Les paramètres du projet peuvent contrôler les paramètres par défaut de l'enregistrement Web sans déploiement de code. Le SDK lit la configuration à distance à chaque appel `start()`. La configuration à distance peut activer ou désactiver entièrement l'enregistrement, ajuster la liste des domaines autorisés et définir une durée maximale de session. Si la configuration à distance n'est pas disponible, `start()` ne continuera pas — ceci est intentionnel pour empêcher l'enregistrement dans un état de projet inconnu.

## Suivi d'itinéraire

Rejourney suit automatiquement les changements de page et d'itinéraire afin que vous puissiez voir le contexte de navigation dans les rediffusions. Ceci est activé par défaut (`autoTrackRoutes: true`) et fonctionne en interceptant les appels de l'historique API (`pushState`, `replaceState`) et en écoutant les événements `popstate`.

### Noms d'itinéraire personnalisés

Par défaut, le `window.location.pathname` actuel est utilisé comme nom d'écran. Pour fournir votre propre logique de dénomination, transmettez une fonction `routeName` :

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Suivi manuel de l'écran

Pour suivre les écrans manuellement (par exemple pour les changements d'onglets ou les transitions d'affichage sur la page), appelez directement `trackScreen` :

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Pour désactiver le suivi automatique de l'itinéraire et compter uniquement sur les appels manuels :

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identification de l'utilisateur

Associez des sessions à vos ID utilisateur internes pour filtrer et rechercher des utilisateurs spécifiques dans le tableau de bord.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Confidentialité:** Utilisez des ID internes ou des UUID. Si vous devez utiliser PII (email, téléphone), hachez-le avant de l'envoyer.

## Événements personnalisés

Suivez les actions significatives des utilisateurs pour comprendre les modèles de comportement, les problèmes de débogage et filtrer les rediffusions de session dans le tableau de bord.

### Utilisation de base

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

| Paramètre | Tapez | Obligatoire | Descriptif |
|---|---|---|---|
| `name` | `string` | Oui | Nom de l'événement — utilisez `snake_case` pour plus de cohérence |
| `properties` | `object` | Non | Paires clé-valeur attachées à cette occurrence d'événement spécifique |

### Exemples

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### Comment les événements apparaissent dans le tableau de bord

Les événements personnalisés sont stockés par session et visibles à deux endroits :

1. **Chronologie de la rediffusion de la session** — Les événements apparaissent sous forme de marqueurs sur la chronologie de relecture afin que vous puissiez accéder au moment exact où une action s'est produite.
2. **Filtres d'archives de session** — Filtrez la liste des sessions par :
   - **Nom de l'événement** — Rechercher toutes les sessions contenant un événement spécifique (par exemple `purchase_completed`)
   - **Propriété d'événement** — Affinez davantage par clé de propriété et/ou valeur (par exemple `plan = pro`)
   - **Nombre d'événements** — Rechercher des sessions avec un nombre spécifique d'événements personnalisés (par exemple, plus de 5 événements)

### Meilleures pratiques




> [!TIP]
> - Utilisez un nom cohérent (`snake_case`, par exemple `button_clicked` et non `Button Clicked`)
> - Gardez les valeurs de propriété simples (chaînes, nombres, booléens) — évitez les objets imbriqués
> - Concentrez-vous sur les actions importantes pour le débogage ou l'analyse – n'enregistrez pas tout
> - Les propriétés sont destinées au contexte par événement. Pour les attributs au niveau de la session, utilisez plutôt **Métadonnées**

---

## Métadonnées

Attachez des paires clé-valeur au niveau de la session qui décrivent le contexte de l'utilisateur ou de la session. Contrairement aux événements, les métadonnées sont définies une fois par clé et s'appliquent à l'ensemble de la session.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

Les valeurs de métadonnées doivent être `string`, `number` ou `boolean`. Les objets et les tableaux ne sont pas acceptés.

### Quand utiliser les métadonnées par rapport aux événements

| Cas d'utilisation | Utiliser **Métadonnées** | Utiliser **Événements** |
|---|---|---|
| Plan d'abonnement de l'utilisateur | `setMetadata('plan', 'pro')` | |
| L'utilisateur a cliqué sur un bouton | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de test A/B | `setMetadata('ab_variant', 'v2')` | |
| Achat terminé | | `logEvent('purchase', { amount: 29 })` |
| Rôle de l'utilisateur | `setMetadata('role', 'admin')` | |
| Étape d'intégration atteinte | | `logEvent('onboarding_step', { step: 3 })` |

**Règle générale :** S'il décrit *qui est l'utilisateur* ou *dans quel état il se trouve*, utilisez des métadonnées. S'il décrit *quelque chose qui s'est produit*, utilisez des événements.

## Contrôles de confidentialité

Toutes les saisies de texte sont masquées par défaut (`maskAllInputs: true`). Les champs masqués apparaissent sous forme d'entrées vides dans les rediffusions et les valeurs ne sont jamais capturées à la source. Le mot de passe, l'e-mail, le téléphone et d'autres types de saisie sensibles sont toujours masqués quel que soit ce paramètre.

### Éléments bloquants

Pour exclure complètement un élément DOM des rediffusions (il apparaît sous la forme d'un espace réservé solide), ajoutez l'un des éléments suivants :

- Classe CSS : `rr-block`
- Attribut de données : `data-rj-block` ou `data-rejourney-block`
- Sélecteur CSS personnalisé via l'option de configuration `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Texte de masquage

Pour masquer le contenu textuel d'un élément (le texte est remplacé mais la forme de l'élément reste visible), ajoutez l'un des éléments suivants :

- Classe CSS : `rr-mask`
- Attribut de données : `data-rj-mask`, `data-rejourney-mask`, `data-private` ou tout `data-testid` contenant `"password"`
- Sélecteur CSS personnalisé via l'option de configuration `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignorer les éléments

Pour capturer la forme d'un élément mais supprimer tous les événements d'interaction (clics, entrées) sur celui-ci, ajoutez :

- Classe CSS : `rr-ignore`
- Attribut de données : `data-rj-ignore` ou `data-rejourney-ignore`

### Fonctions de masquage personnalisées

Pour la logique de masquage programmatique, utilisez `maskInputFn` ou `maskTextFn` :

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Consentement de l'utilisateur et GDPR




> [!IMPORTANT]
> **Vous êtes le responsable du traitement des données.** Rejourney agit en tant que sous-traitant des données en votre nom. Vous êtes responsable de vous assurer que vos utilisateurs finaux sont informés de l'enregistrement de session et que vous disposez d'une base juridique valide pour traiter leurs données (par exemple, consentement ou intérêts légitimes).

#### Ce que tu dois faire

1. **Divulguez l'enregistrement de la session dans votre politique de confidentialité.** Inclut un langage tel que :

   > * "Nous utilisons Rejourney pour enregistrer des rediffusions de session anonymisées et non anonymisées de votre activité sur notre site Web afin de nous aider à améliorer le produit et à réduire les frictions. Les données de session peuvent inclure les interactions entre les pages, les informations du navigateur et l'emplacement approximatif. Les saisies de texte et les éléments sensibles sont automatiquement masqués et jamais capturés. "*

2. **Enregistrement de porte après consentement** (recommandé pour les utilisateurs de l'EEE) :

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respectez les désinscriptions.** Si un utilisateur retire son consentement, arrêtez l'enregistrement et effacez son identité :

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Consentement granulaire via `setConsent`

Pour un contrôle plus précis, utilisez `setConsent` pour basculer indépendamment entre l'analyse et la relecture :

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

La configuration simultanée de `analytics: false` et de `replay: false` arrête la session et efface toutes les données en file d'attente. Le réglage de `replay: false` seul arrête l'enregistreur rrweb mais maintient le suivi des événements en cours.

#### Capture du journal de la console

La capture du journal de la console est désactivée par défaut (`trackConsoleLogs: false`). Activez-le uniquement si vous en avez besoin, car les journaux de la console peuvent contenir PII en fonction de vos pratiques de journalisation :

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Géolocalisation

La géolocalisation dérivée de l'IP (pays, région, ville) est collectée par défaut. Lorsque `collectGeoLocation` est `false`, le SDK transmet un indicateur qui supprime la recherche de géolocalisation IP sur le backend — aucune donnée de localisation n'est stockée pour cette session :

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Mode d'observation uniquement (pas d'enregistrement visuel)

Pour capturer les erreurs, les tâches longues, l'activité réseau et les analyses **sans** enregistrant des rediffusions visuelles, définissez `observeOnly: true` :

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Lorsqu'elle est activée, toutes les données télémétriques sont collectées mais aucun enregistrement rrweb n'est exécuté : les sessions n'apparaîtront pas dans votre page Replays, mais les analyses complètes, les erreurs et les données réseau sont toujours capturées. Utile lorsqu'un utilisateur a désactivé l'enregistrement visuel mais que vous souhaitez toujours l'observabilité.

> **Note:** Vous pouvez définir cela de manière conditionnelle par utilisateur, par exemple en fonction d'une préférence de consentement enregistrée :
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Détection des robots

Les robots et les navigateurs automatisés sont ignorés par défaut (`ignoreBots: true`). Playwright, Puppeteer, Selenium et autres clients basés sur un pilote Web sont supprimés. Pour enregistrer des sessions d'automatisation (par exemple pour les outils internes) :

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Pour fournir un modèle de détection de robot personnalisé :

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Capture de requêtes réseau

Les requêtes réseau (fetch et XHR) sont interceptées et enregistrées par défaut (`autoTrackNetwork: true`). Les tailles de corps de demande et de réponse sont **pas** capturées par défaut (`networkCaptureSizes: false`). Les URL, méthodes, codes d'état et durées sont toujours capturés.

Pour exclure des URL spécifiques :

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Pour filtrer ou supprimer les demandes avant leur envoi :

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Référence de configuration

| Options | Tapez | Par défaut | Descriptif |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Appelez automatiquement `start()` une fois `init()` terminé |
| `disableInDev` | `boolean` | `false` | Supprimer l'enregistrement sur `localhost` et `127.0.0.1` |
| `debug` | `boolean` | `false` | Activer la journalisation détaillée SDK sur la console du navigateur |
| `enabled` | `boolean` | `true` | Coupe-circuit principal — réglé sur `false` pour empêcher tout enregistrement |
| `observeOnly` | `boolean` | `false` | Capturez les analyses/erreurs/réseau sans relecture visuelle |
| `captureReplay` | `boolean` | `true` | Activer la capture de relecture visuelle rrweb |
| `allowedDomains` | `string[]` | `[]` | Restreindre l'enregistrement à des domaines spécifiques. Vide signifie que tous les domaines sont autorisés. Prend en charge les caractères génériques `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Durée maximale de la session en millisecondes (par défaut : 30 minutes) |
| `collectGeoLocation` | `boolean` | `true` | Collecter le pays/la région/la ville dérivée de l'adresse IP |
| `captureAttribution` | `boolean` | `true` | Capturez les paramètres UTM, le référent et l'URL d'entrée au démarrage de la session |
| `ignoreBots` | `boolean` | `true` | Supprimer l'enregistrement des robots et pilotes Web détectés |
| `recordAutomation` | `boolean` | `false` | Autoriser l'enregistrement des sessions de dramaturge/marionnettiste/sélénium |
| `autoTrackRoutes` | `boolean` | `true` | Suivre automatiquement les changements d'itinéraire via l'historique API |
| `routeName` | `(location: Location) => string` | — | Fonction personnalisée pour dériver le nom d'écran de `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Intercepter et enregistrer les requêtes de récupération/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL à exclure du suivi du réseau |
| `networkCaptureSizes` | `boolean` | `false` | Inclure la taille du corps des requêtes/réponses dans les journaux réseau |
| `trackConsoleLogs` | `boolean` | `false` | Capturer la sortie `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Détecter et enregistrer les tâches longues (blocs de thread JS > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Capturer les chargements de ressources ayant échoué (images, scripts, feuilles de style) |
| `maskAllInputs` | `boolean` | `true` | Masquer toutes les valeurs de saisie de texte dans les rediffusions |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Classe CSS pour bloquer complètement la relecture d'un élément |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Sélecteur CSS pour bloquer complètement la relecture des éléments |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Classe CSS pour ignorer les événements d'interaction sur un élément |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Sélecteur CSS pour ignorer les événements d'interaction |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Classe CSS pour masquer le contenu du texte en replay |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Sélecteur CSS pour masquer le contenu du texte |
| `maskInputFn` | `(value, element) => string` | — | Fonction personnalisée pour transformer les valeurs d'entrée avant la capture |
| `maskTextFn` | `(text, element) => string` | — | Fonction personnalisée pour transformer le contenu du texte avant la capture |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Fonction personnalisée pour décider par chargement de page s'il faut enregistrer |
| `beforeSendEvent` | `(event) => event \| null` | — | Filtrez ou modifiez les événements avant qu'ils ne soient mis en file d'attente. Renvoyez `null` pour déposer |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtrez ou modifiez les entrées réseau avant qu’elles ne soient mises en file d’attente. Renvoyez `null` pour déposer |
| `onAuthError` | `(error) => void` | — | Appelé lorsque le SDK ne parvient pas à s'authentifier auprès du backend |

## Arrêter l'enregistrement

Appelez `stop()` pour mettre fin à la session, vider tous les événements en attente et nettoyer tous les écouteurs SDK :

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` peut être appelé plusieurs fois en toute sécurité. Après l'arrêt, appelez à nouveau `start()` pour commencer une nouvelle session.

## ID de session

Accédez à l'ID de session actuelle pour corréler les sessions Rejourney avec vos propres journaux ou outils d'assistance :

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Renvoie `null` si aucune session n'est active.

## Aides de statut

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```

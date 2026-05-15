<!-- AI_PROMPT_SECTION -->
**Vous utilisez Cursor, Claude ou ChatGPT ?** Copiez l'invite d'intégration et collez-la dans votre assistant AI pour générer automatiquement le code de configuration.

<!-- /AI_PROMPT_SECTION -->

## Installation

Ajoutez le package Rejourney à votre projet à l'aide de npm ou yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney nécessite du code natif et n'est pas compatible avec Expo Go. Utiliser les versions de développement :
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Configuration à 3 lignes

Initialisez et démarrez Rejourney en haut de votre application (par exemple dans App.tsx ou index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Ne nécessite aucun emballage de fournisseur. L'enregistrement démarre immédiatement.

## Paramètres d'enregistrement à distance

Les paramètres du projet peuvent contrôler les paramètres d’enregistrement par défaut du React Native sans envoyer de nouvelle version d’application. Les versions SDK prises en charge lisent le paramètre FPS d'enregistrement à distance au démarrage de la session ; la valeur par défaut est 1 FPS et les administrateurs de projet peuvent choisir 1, 2 ou 3 FPS. Si la configuration distante n'est pas disponible, le SDK revient au comportement de capture local/par défaut.

## Suivi d'écran

Rejourney suit automatiquement les changements d'écran afin que vous puissiez voir où se trouvent les utilisateurs dans votre application pendant les rediffusions. Choisissez la configuration qui correspond à votre bibliothèque de navigation :

### Expo Router (Automatique)

Si vous utilisez **Expo Router**, le suivi d'écran fonctionne immédiatement. Aucun code supplémentaire n'est nécessaire.




> [!TIP]
> **Vous utilisez des pseudonymes personnalisés ?** Si vous utilisez Expo Router mais souhaitez fournir manuellement vos propres noms d'écran, consultez la section [Noms d'écran personnalisés](#custom-screen-names) ci-dessous.

---

### React Navigation

Si vous utilisez **React Navigation** (`@react-navigation/native`), utilisez le hook `useNavigationTracking` dans votre racine `NavigationContainer` :

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### Noms d’écran personnalisés

Si vous souhaitez spécifier manuellement les noms d'écran (par exemple, pour des raisons de cohérence analytique ou si vous n'utilisez pas les bibliothèques ci-dessus), utilisez la méthode `trackScreen`.

#### Pour les utilisateurs de Expo Router :
Pour utiliser des noms personnalisés avec Expo Router, vous devez d'abord désactiver le suivi automatique dans votre configuration :

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Appel de suivi manuel :
Appelez `trackScreen` chaque fois qu'un changement d'écran se produit :

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identification de l'utilisateur

Associez des sessions à vos ID utilisateur internes pour filtrer et rechercher des utilisateurs spécifiques dans le tableau de bord.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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
import { Rejourney } from '@rejourneyco/react-native';

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
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### Quand utiliser les métadonnées par rapport aux événements

| Cas d'utilisation | Utiliser **Métadonnées** | Utiliser **Événements** |
|---|---|---|
| Plan d'abonnement de l'utilisateur |  `setMetadata('plan', 'pro')` | |
| L'utilisateur a cliqué sur un bouton | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de test A/B |  `setMetadata('ab_variant', 'v2')` | |
| Achat terminé | |  `logEvent('purchase', { amount: 29 })` |
| Rôle de l'utilisateur |  `setMetadata('role', 'admin')` | |
| Étape d'intégration atteinte | |  `logEvent('onboarding_step', { step: 3 })` |

**Règle générale :** S'il décrit *qui est l'utilisateur* ou *dans quel état il se trouve*, utilisez des métadonnées. S'il décrit *quelque chose qui s'est produit*, utilisez des événements.

## Contrôles de confidentialité

Les saisies de texte et les vues de la caméra sont automatiquement masquées par défaut. Les administrateurs de projet peuvent modifier le niveau de masquage de saisie de texte par défaut dans les paramètres du projet pour les versions SDK prises en charge ; les anciennes versions de SDK ignorent ce paramètre distant et conservent leur comportement de masquage existant. Les champs sécurisés/mot de passe, les vues de caméra et les masques explicites restent protégés.

Pour masquer manuellement des interfaces utilisateur sensibles supplémentaires, enveloppez les composants dans le composant `Mask` :

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Le contenu masqué apparaît sous la forme d'un rectangle plein dans les rediffusions et n'est jamais capturé à la source.

### Consentement de l'utilisateur et GDPR




> [!IMPORTANT]
> **Vous êtes le responsable du traitement des données.** Rejourney agit en tant que sous-traitant des données en votre nom. Vous êtes responsable de vous assurer que vos utilisateurs finaux sont informés de l'enregistrement de la session et que vous disposez d'une base juridique valide pour traiter leurs données (par exemple, consentement ou intérêts légitimes).

#### Ce que tu dois faire

1. **Divulguez l'enregistrement de la session dans la politique de confidentialité de votre application.** Inclut un langage tel que :

   > * "Nous utilisons Rejourney pour enregistrer des rediffusions de session anonymisées ET non anonymisées de votre activité dans l'application afin de nous aider à améliorer le produit, à suivre les pannes et les problèmes et à réduire les frictions du produit. Les données de session peuvent inclure des interactions à l'écran, des informations sur l'appareil et une localisation approximative. Les saisies de texte et les éléments sensibles de l'interface utilisateur sont automatiquement masqués et jamais capturés. "*

2. **Enregistrement de porte après consentement** (recommandé pour les utilisateurs de l'EEE) :

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respectez les désinscriptions.** Si un utilisateur retire son consentement, arrêtez l'enregistrement et effacez ses données :

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Capture du journal de la console

La capture du journal de la console est activée par défaut (`trackConsoleLogs: true`). Les journaux de la console peuvent contenir PII en fonction des pratiques de journalisation de votre application. Désactivez-le si des données sensibles peuvent apparaître dans les journaux :

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Géolocalisation

La géolocalisation dérivée de l'IP (pays, région, ville) est collectée par défaut. Lorsque `collectGeoLocation` est `false`, le SDK transmet un indicateur à la couche native qui supprime la recherche de géolocalisation IP sur le backend — aucune donnée de localisation n'est stockée pour cette session. Désactivez-le si vous n'avez pas besoin de données de localisation ou si vous souhaitez minimiser la collecte de données pour les utilisateurs de l'EEE :

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Feuilles natives

La capture de feuille native est activée par défaut (`captureNativeSheets: true`) pour les versions SDK prises en charge. Cela permet aux feuilles et boîtes de dialogue natives appartenant à l'application, telles que les modalités d'autorisation de paiement, d'apparaître dans les rediffusions de débogage lorsque le système d'exploitation autorise la capture. Les feuilles du système de clavier/saisie de texte sont exclues lorsque les saisies de texte sont masquées par défaut. Lorsque le masquage de saisie de texte est défini sur des champs sécurisés uniquement, les claviers ne font que faire de leur mieux et ne peuvent pas être capturés de manière fiable, en particulier lorsque le système d'exploitation les affiche comme des surfaces protégées ou distantes. Les feuilles de partage du système d'exploitation sont également fournies au mieux et ne peuvent pas être capturées de manière fiable lorsque le système les restitue sous forme de surfaces protégées ou distantes.

Désactivez la capture de feuille native si vous souhaitez que la relecture visuelle reste limitée à la fenêtre principale de l'application :

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Mode d'observation uniquement (pas d'enregistrement visuel)

Pour capturer les erreurs, les plantages, ANRs et l'activité réseau **sans** enregistrant des rediffusions visuelles, définissez `observeOnly: true` :

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Lorsqu'elle est activée, toute la télémétrie est collectée mais aucune capture d'écran n'est prise — les sessions n'apparaîtront PAS dans votre page de rediffusions mais il y aura des données complètes d'analyse/erreur/réseau/plantage. Pas de rediffusion. Ceci est utile lorsque les utilisateurs ont désactivé l'enregistrement d'écran mais que vous souhaitez toujours une visibilité sur les erreurs.

> **Note:** Cela peut être défini de manière conditionnelle par utilisateur, par exemple en fonction d'une préférence stockée ou d'un indicateur de consentement :
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```

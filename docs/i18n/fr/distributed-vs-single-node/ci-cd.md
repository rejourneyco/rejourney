# CI/CD et tests automatisés

Rejourney utilise GitHub Actions pour garantir la qualité du code sur l'ensemble du monorepo. Chaque pull request et push vers la branche principale déclenche une batterie complète de tests.

## Suites de tests

### 1. Tests back-end API
Situés dans le répertoire `backend/`, ces tests garantissent la stabilité de la logique principale et des interactions avec la base de données.
* **Pelucheux** : utilise ESLint pour appliquer le style de code et détecter les erreurs courantes.
* **Tests unitaires** : optimisé par Vitest, test de la logique de service, des fonctions utilitaires et des contrôleurs API.
* **Vérification de la construction** : garantit que la source TypeScript se compile correctement dans la distribution finale.

### 2. Essais React Native SDK
Situés dans `packages/react-native/`, ces tests sont essentiels à la stabilité multiplateforme.
* **TypeScript Vérifier** : valide les types sur l'ensemble du SDK, en détectant les inadéquations potentielles des ponts.
* **Pelucheux** : assure une qualité de code cohérente.
* **Vérification de la construction** : exécute le script de préparation pour garantir que le package peut être regroupé pour la distribution.

### 3. Tests du tableau de bord Web
Situé dans `dashboard/web-ui/`, axé sur l'interface utilisateur et le SSR.
* **TypeScript Vérifier** : inclut la génération de type React Router pour garantir la sécurité des itinéraires.
* **Construction RSS** : vérifie que l'intégralité de l'application Remix/React Router peut être créée pour le rendu côté serveur.

---

## Tests d'intégration native
L'une des parties les plus robustes de notre CI/CD est la validation du SDK sur des environnements de plateforme réels.

### Intégration iOS (dernière macos)
* **Nouvelle installation** : Le CI crée un tout nouveau projet React Native à partir de zéro.
* **Injection de colis** : il regroupe le SDK local à l'aide de `npm pack` et l'installe dans l'application de test.
* **Vérification CocoaPods** : exécute `pod install` pour garantir que les dépendances natives et les podspecs sont correctement liées.
* **Vérification de la construction** : exécute `xcodebuild` pour garantir que l'application de test se compile correctement avec le SDK intégré.

### Intégration Android (ubuntu-dernière)
* **Nouvelle installation** : similaire à iOS, un nouveau projet React Native basé sur Android est initialisé.
* **Vérification de la construction** : exécute `./gradlew assembleDebug` pour garantir qu'il n'y a pas de conflits manifestes ou d'erreurs de compilation dans le code natif de Android.

---

## Logique de déploiement et de publication

### Déploiement cloud automatisé (VPS)
Le déploiement sur notre environnement de production est limité par la gestion des versions.
* **Vérification des versions** : une tâche dédiée compare la version racine de `package.json` à la validation précédente.
* **Déclencheur conditionnel** : le déploiement se poursuit uniquement si la version a été incrémentée.
* **Déploiement automatisé** : s'il est déclenché, il applique les derniers manifestes K8 et effectue un redémarrage progressif de tous les déploiements (API, Web et nœuds de calcul).

### Publication automatisée SDK (NPM)
Nous maintenons un flux de publication transparent pour le package `rejourney`.
* **Sensible au chemin** : se déclenche uniquement lorsque les fichiers contenus dans `packages/react-native/` sont modifiés.
* **Vérification du registre** : compare la version du package local à la dernière version du registre NPM.
* **Publication automatique** : si la version locale est supérieure, il publie automatiquement la nouvelle version sur NPM une fois tous les tests réussis.

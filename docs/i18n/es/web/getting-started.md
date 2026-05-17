<!-- AI_PROMPT_SECTION -->
**¿Utiliza Cursor, Claude o ChatGPT?** Copie el mensaje de integración y péguelo en su asistente AI para generar automáticamente el código de configuración.

<!-- /AI_PROMPT_SECTION -->

## Instalación

Agregue el paquete Rejourney a su proyecto usando npm o yarn.

```bash
npm install @rejourneyco/browser
```

## Configuración básica

Inicialice e inicie Rejourney en el punto de entrada de su aplicación.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` recupera la configuración remota de su proyecto y prepara el SDK. `start` inicia la sesión, registra al visitante y (si la reproducción está habilitada) inicia la grabadora rrweb. Ambos son asíncronos y es seguro llamarlos sin esperar si no necesita bloquear nada al finalizar.




> [!NOTE]
> `autoStart` es `false` de forma predeterminada. Debe llamar explícitamente a `start()`, lo que le permite bloquear la grabación detrás de una verificación de consentimiento. Para iniciar automáticamente después de `init`, pase `{ autoStart: true }`.

### Integraciones de marco

El paquete incluye puntos de entrada dedicados para marcos populares. Utilice el que coincida con su pila, o utilice el API básico de arriba desde cualquier marco.

---

#### Reaccionar

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

`startOnMount` tiene como valor predeterminado `false` en `RejourneyProvider`. Pase `startOnMount` (o `startOnMount={true}`) para comenzar a grabar tan pronto como se monte el componente.

---

#### Siguiente.js

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

`RejourneyNext` es un componente `'use client'` que representa `null`. `startOnMount` tiene como valor predeterminado `true`. Los cambios de ruta se rastrean automáticamente a través del Historial API.

---

#### vista

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

La instancia Rejourney está disponible a través de `app.config.globalProperties.$rejourney` y a través de `inject('rejourney')`. El elemento componible `useRejourney()` también se exporta para mayor comodidad.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

El sufijo `.client.ts` garantiza que este complemento se ejecute solo en el navegador. La instancia Rejourney se inyecta como `$rejourney` y está disponible a través de `useNuxtApp().$rejourney`.

---

#### Esbelto / EsbeltoKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` devuelve una función de limpieza que llama a `Rejourney.stop()`: el valor de retorno `onMount` de Svelte se utiliza como devolución de llamada de destrucción automáticamente.

---

#### Angular

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

`createRejourneyAppInitializer` devuelve una fábrica que inicializa e inicia Rejourney durante la fase de arranque de Angular. También puede inyectar `RejourneyService` para un API basado en clases.

---

#### remezclar

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

`startOnMount` tiene como valor predeterminado `true`. Los cambios de ruta se rastrean automáticamente.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` no funciona en entornos SSR: comprueba `window` antes de ejecutarlo.

---

## Configuración de grabación remota

La configuración del proyecto puede controlar los valores predeterminados de grabación web sin implementar código. El SDK lee la configuración remota en cada llamada `start()`. La configuración remota puede habilitar o deshabilitar la grabación por completo, ajustar la lista de dominios permitidos y establecer una duración máxima de la sesión. Si la configuración remota no está disponible, `start()` no continuará; esto es intencional para evitar la grabación en un estado de proyecto desconocido.

## Seguimiento de ruta

Rejourney rastrea automáticamente los cambios de página y ruta para que puedas ver el contexto de navegación en las repeticiones. Esto está habilitado de forma predeterminada (`autoTrackRoutes: true`) y funciona interceptando las llamadas del historial API (`pushState`, `replaceState`) y escuchando los eventos `popstate`.

### Nombres de ruta personalizados

De forma predeterminada, se utiliza el `window.location.pathname` actual como nombre de pantalla. Para proporcionar su propia lógica de nomenclatura, pase una función `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Seguimiento de pantalla manual

Para realizar un seguimiento de las pantallas manualmente (por ejemplo, para cambios de pestañas o transiciones de vistas en la página), llame directamente a `trackScreen`:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Para desactivar el seguimiento automático de rutas y confiar únicamente en llamadas manuales:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identificación de usuario

Asocie sesiones con sus ID de usuario internos para filtrar y buscar usuarios específicos en el panel.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacidad:** Utilice ID internos o UUID. Si debe utilizar PII (correo electrónico, teléfono), haga un hash antes de enviarlo.

## Eventos personalizados

Realice un seguimiento de las acciones significativas del usuario para comprender patrones de comportamiento, depurar problemas y filtrar las repeticiones de sesiones en el panel.

### Uso básico

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

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | `string` | Sí | Nombre del evento: utilice `snake_case` para mantener la coherencia |
| `properties` | `object` | No | Pares clave-valor adjuntos a este evento específico |

### Ejemplos

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

### Cómo aparecen los eventos en el panel

Los eventos personalizados se almacenan por sesión y son visibles en dos lugares:

1. **Cronograma de repetición de la sesión**: los eventos aparecen como marcadores en la línea de tiempo de repetición para que puedas saltar al momento exacto en que ocurrió una acción.
2. **Filtros de archivo de sesión**: filtrar la lista de sesiones por:
   - **Nombre del evento**: busque todas las sesiones que contengan un evento específico (por ejemplo, `purchase_completed`)
   - **Propiedad del evento**: limitar aún más por clave de propiedad y/o valor (por ejemplo, `plan = pro`)
   - **Recuento de eventos**: busque sesiones con una cantidad específica de eventos personalizados (por ejemplo, más de 5 eventos)

### Mejores prácticas




> [!TIP]
> - Utilice nombres coherentes (`snake_case`, por ejemplo, `button_clicked`, no `Button Clicked`).
> - Mantenga los valores de las propiedades simples (cadenas, números, booleanos): evite los objetos anidados
> - Céntrese en acciones importantes para la depuración o el análisis; no registre todo
> - Las propiedades son para el contexto por evento. Para atributos a nivel de sesión, utilice **Metadatos** en su lugar.

---

## Metadatos

Adjunte pares clave-valor a nivel de sesión que describan el contexto del usuario o de la sesión. A diferencia de los eventos, los metadatos se configuran una vez por clave y se aplican a toda la sesión.

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

Los valores de metadatos deben ser `string`, `number` o `boolean`. No se aceptan objetos ni matrices.

### Cuándo utilizar metadatos frente a eventos

| Caso de uso | Utilice **Metadatos** | Utilice **Eventos** |
|---|---|---|
| Plan de suscripción del usuario | `setMetadata('plan', 'pro')` | |
| El usuario hizo clic en un botón | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de prueba A/B | `setMetadata('ab_variant', 'v2')` | |
| Compra completada | | `logEvent('purchase', { amount: 29 })` |
| Rol del usuario | `setMetadata('role', 'admin')` | |
| Paso de incorporación alcanzado | | `logEvent('onboarding_step', { step: 3 })` |

**Regla de oro:** Si describe *quién es el usuario* o *en qué estado se encuentra*, utilice metadatos. Si describe *algo que sucedió*, use eventos.

## Controles de privacidad

Todas las entradas de texto están enmascaradas de forma predeterminada (`maskAllInputs: true`). Los campos enmascarados aparecen como entradas en blanco en las repeticiones y los valores nunca se capturan en la fuente. La contraseña, el correo electrónico, el teléfono y otros tipos de entrada confidenciales siempre están enmascarados independientemente de esta configuración.

### Elementos de bloqueo

Para excluir completamente un elemento DOM de las repeticiones (aparece como un marcador de posición sólido), agregue uno de los siguientes:

- Clase CSS: `rr-block`
- Atributo de datos: `data-rj-block` o `data-rejourney-block`
- Selector de CSS personalizado a través de la opción de configuración `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Texto de enmascaramiento

Para enmascarar el contenido del texto de un elemento (el texto se reemplaza pero la forma del elemento permanece visible), agregue uno de los siguientes:

- Clase CSS: `rr-mask`
- Atributo de datos: `data-rj-mask`, `data-rejourney-mask`, `data-private` o cualquier `data-testid` que contenga `"password"`.
- Selector de CSS personalizado a través de la opción de configuración `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignorar elementos

Para capturar la forma de un elemento pero suprimir todos los eventos de interacción (clics, entradas) en él, agregue:

- Clase CSS: `rr-ignore`
- Atributo de datos: `data-rj-ignore` o `data-rejourney-ignore`

### Funciones de enmascaramiento personalizadas

Para la lógica de enmascaramiento programático, utilice `maskInputFn` o `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Consentimiento del usuario y GDPR




> [!IMPORTANT]
> **Usted es el responsable del tratamiento de datos.** Rejourney actúa como Procesador de datos en su nombre. Usted es responsable de garantizar que sus usuarios finales estén informados sobre la grabación de sesiones y de que tiene una base legal válida para procesar sus datos (por ejemplo, consentimiento o intereses legítimos).

#### que debes hacer

1. **Divulgue la grabación de la sesión en su política de privacidad.** Incluye lenguaje como:

   > * "Utilizamos Rejourney para registrar repeticiones de sesiones anónimas y no anónimas de su actividad en nuestro sitio web para ayudarnos a mejorar el producto y reducir la fricción. Los datos de la sesión pueden incluir interacciones de la página, información del navegador y ubicación aproximada. Las entradas de texto y los elementos confidenciales se enmascaran automáticamente y nunca se capturan".*

2. **Grabación de puerta detrás del consentimiento** (recomendado para usuarios del EEE):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respete las exclusiones.** Si un usuario retira su consentimiento, deje de grabar y borre su identidad:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Consentimiento granular a través de `setConsent`

Para un control más preciso, utilice `setConsent` para alternar de forma independiente análisis y reproducción:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

La configuración conjunta de `analytics: false` y `replay: false` detiene la sesión y borra todos los datos en cola. Configurar solo `replay: false` detiene la grabadora rrweb pero mantiene el seguimiento de eventos en ejecución.

#### Captura de registros de consola

La captura de registros de la consola está deshabilitada de forma predeterminada (`trackConsoleLogs: false`). Habilítelo solo si lo necesita, ya que los registros de la consola pueden contener PII dependiendo de sus prácticas de registro:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolocalización

La geolocalización derivada de IP (país, región, ciudad) se recopila de forma predeterminada. Cuando `collectGeoLocation` es `false`, SDK pasa un indicador que suprime la búsqueda de geolocalización de IP en el backend; no se almacenan datos de ubicación para esa sesión:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Modo de sólo observación (sin grabación visual)

Para capturar errores, tareas largas, actividad de red y análisis **sin** que graban repeticiones visuales, configure `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Cuando está habilitado, se recopila toda la telemetría, pero no se ejecuta ninguna grabación rrweb; las sesiones no aparecerán en su página de Repeticiones, pero aún se capturan datos completos de análisis, errores y red. Útil cuando un usuario ha optado por no participar en la grabación visual pero aún desea visibilidad.

> **Nota:** Puede configurar esto de forma condicional por usuario, por ejemplo, según una preferencia de consentimiento almacenada:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Detección de robots

Los bots y los navegadores automatizados se ignoran de forma predeterminada (`ignoreBots: true`). Se suprimen Playwright, Puppeteer, Selenium y otros clientes basados ​​en controladores web. Para grabar sesiones de automatización (por ejemplo, para herramientas internas):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Para proporcionar un patrón de detección de bots personalizado:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Captura de solicitud de red

Las solicitudes de red (fetch y XHR) se interceptan y registran de forma predeterminada (`autoTrackNetwork: true`). Los tamaños de cuerpo de solicitud y respuesta son **no** capturados de forma predeterminada (`networkCaptureSizes: false`). Siempre se capturan las URL, los métodos, los códigos de estado y las duraciones.

Para excluir URL específicas:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Para filtrar o redactar solicitudes antes de enviarlas:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Referencia de configuración

| Opción | Tipo | Predeterminado | Descripción |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Llame a `start()` automáticamente después de que se complete `init()` |
| `disableInDev` | `boolean` | `false` | Suprimir grabación en `localhost` y `127.0.0.1` |
| `debug` | `boolean` | `false` | Habilite el registro detallado SDK en la consola del navegador |
| `enabled` | `boolean` | `true` | Interruptor de apagado maestro: configurado en `false` para evitar cualquier grabación |
| `observeOnly` | `boolean` | `false` | Capture análisis/errores/red sin repetición visual |
| `captureReplay` | `boolean` | `true` | Habilitar la captura de reproducción visual de rrweb |
| `allowedDomains` | `string[]` | `[]` | Restrinja la grabación a dominios específicos. Vacío significa todos los dominios permitidos. Admite comodines `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Duración máxima de la sesión en milisegundos (predeterminado: 30 minutos) |
| `collectGeoLocation` | `boolean` | `true` | Recopilar país/región/ciudad derivados de IP |
| `captureAttribution` | `boolean` | `true` | Capture parámetros UTM, referencia y URL de entrada al inicio de la sesión |
| `ignoreBots` | `boolean` | `true` | Suprimir la grabación de bots y controladores web detectados |
| `recordAutomation` | `boolean` | `false` | Permitir grabación de sesiones de Dramaturgo/Titiritero/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Realice un seguimiento automático de los cambios de ruta a través del Historial API |
| `routeName` | `(location: Location) => string` | — | Función personalizada para derivar el nombre de pantalla de `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Interceptar y registrar solicitudes de recuperación/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL para excluir del seguimiento de la red |
| `networkCaptureSizes` | `boolean` | `false` | Incluir tamaños de cuerpo de solicitud/respuesta en registros de red |
| `trackConsoleLogs` | `boolean` | `false` | Captura de salida `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Detectar y registrar tareas largas (bloques de subprocesos JS > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Capture cargas de recursos fallidas (imágenes, scripts, hojas de estilo) |
| `maskAllInputs` | `boolean` | `true` | Enmascarar todos los valores de entrada de texto en repeticiones |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Clase CSS para bloquear completamente la reproducción de un elemento |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Selector CSS para bloquear completamente elementos de la reproducción |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Clase CSS para ignorar eventos de interacción en un elemento |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Selector CSS para ignorar eventos de interacción |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Clase CSS para enmascarar contenido de texto en reproducción |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Selector CSS para enmascarar contenido de texto |
| `maskInputFn` | `(value, element) => string` | — | Función personalizada para transformar valores de entrada antes de la captura |
| `maskTextFn` | `(text, element) => string` | — | Función personalizada para transformar contenido de texto antes de la captura |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Función personalizada para decidir por carga de página si se graba |
| `beforeSendEvent` | `(event) => event \| null` | — | Filtre o modifique eventos antes de que se pongan en cola. Devuelve `null` para soltar |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtre o modifique las entradas de la red antes de que se pongan en cola. Devuelve `null` para soltar |
| `onAuthError` | `(error) => void` | — | Se llama cuando SDK no puede autenticarse con el backend |

## Detener la grabación

Llame a `stop()` para finalizar la sesión, eliminar cualquier evento pendiente y limpiar todos los oyentes SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

Es seguro llamar a `stop()` varias veces. Después de detenerse, llame nuevamente a `start()` para comenzar una nueva sesión.

## ID de sesión

Acceda al ID de sesión actual para correlacionar sesiones Rejourney con sus propios registros o herramientas de soporte:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Devuelve `null` si no hay ninguna sesión activa.

## Ayudantes de estado

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```

<!-- AI_PROMPT_SECTION -->
**¿Utiliza Cursor, Claude o ChatGPT?** Copie el mensaje de integración y péguelo en su asistente AI para generar automáticamente el código de configuración.

<!-- /AI_PROMPT_SECTION -->

## Instalación

Agregue el paquete Rejourney a su proyecto usando npm o yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney requiere código nativo y no es compatible con Expo Go. Utilice compilaciones de desarrollo:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Configuración de 3 líneas

Inicialice e inicie Rejourney en la parte superior de su aplicación (por ejemplo, en App.tsx o index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

No requiere envoltura del proveedor. La grabación comienza inmediatamente.

## Configuración de grabación remota

La configuración del proyecto puede controlar los valores predeterminados de grabación de React Native sin enviar una nueva versión de la aplicación. Las versiones compatibles de SDK leen la configuración de FPS de grabación remota al iniciar la sesión; el valor predeterminado es 1 FPS y los administradores del proyecto pueden elegir 1, 2 o 3 FPS. Si la configuración remota no está disponible, SDK vuelve al comportamiento de captura local/predeterminado.

## Seguimiento de pantalla

Rejourney rastrea automáticamente los cambios en la pantalla para que puedas ver dónde están los usuarios en tu aplicación durante las repeticiones. Elija la configuración que coincida con su biblioteca de navegación:

### Expo Router (Automático)

Si utiliza **Expo Router**, el seguimiento de pantalla funciona de inmediato. No se necesita ningún código adicional.




> [!TIP]
> **¿Utiliza nombres de pantalla personalizados?** Si utiliza Expo Router pero desea proporcionar sus propios nombres de pantalla manualmente, consulte la sección [Nombres de pantalla personalizados](#custom-screen-names) a continuación.

---

### React Navigation

Si usa **React Navigation** (`@react-navigation/native`), use el gancho `useNavigationTracking` en su raíz `NavigationContainer`:

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

### Nombres de pantalla personalizados

Si desea especificar manualmente los nombres de pantalla (por ejemplo, para mantener la coherencia analítica o si no usa las bibliotecas anteriores), use el método `trackScreen`.

#### Para usuarios de Expo Router:
Para usar nombres personalizados con Expo Router, primero debe desactivar el seguimiento automático en su configuración:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Llamada de seguimiento manual:
Llame a `trackScreen` cada vez que ocurra un cambio de pantalla:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identificación de usuario

Asocie sesiones con sus ID de usuario internos para filtrar y buscar usuarios específicos en el panel.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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
   - **Nombre del evento**: busca todas las sesiones que contienen un evento específico (por ejemplo, `purchase_completed`)
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

### Cuándo utilizar metadatos frente a eventos

| Caso de uso | Utilice **Metadatos** | Utilice **Eventos** |
|---|---|---|
| Plan de suscripción del usuario |  `setMetadata('plan', 'pro')` | |
| El usuario hizo clic en un botón | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de prueba A/B |  `setMetadata('ab_variant', 'v2')` | |
| Compra completada | |  `logEvent('purchase', { amount: 29 })` |
| Rol del usuario |  `setMetadata('role', 'admin')` | |
| Paso de incorporación alcanzado | |  `logEvent('onboarding_step', { step: 3 })` |

**Regla de oro:** Si describe *quién es el usuario* o *en qué estado se encuentra*, utilice metadatos. Si describe *algo que sucedió*, use eventos.

## Controles de privacidad

Las entradas de texto y las vistas de la cámara se enmascaran automáticamente de forma predeterminada. Los administradores del proyecto pueden cambiar el nivel de enmascaramiento de entrada de texto predeterminado en Configuración del proyecto para las versiones SDK compatibles; Las versiones anteriores de SDK ignoran esa configuración remota y mantienen su comportamiento de enmascaramiento existente. Los campos seguros/contraseña, las vistas de cámara y las máscaras explícitas permanecen protegidos.

Para ocultar manualmente una interfaz de usuario sensible adicional, ajuste los componentes en el componente `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

El contenido enmascarado aparece como un rectángulo sólido en las repeticiones y nunca se captura en la fuente.

### Consentimiento del usuario y GDPR




> [!IMPORTANT]
> **Usted es el responsable del tratamiento de datos.** Rejourney actúa como Procesador de datos en su nombre. Usted es responsable de garantizar que sus usuarios finales estén informados sobre la grabación de sesiones y de que tiene una base legal válida para procesar sus datos (por ejemplo, consentimiento o intereses legítimos).

#### que debes hacer

1. **Divulgue la grabación de la sesión en la política de privacidad de su aplicación.** Incluye lenguaje como:

   > * "Usamos Rejourney para grabar repeticiones de sesiones anónimas y no anónimas de su actividad en la aplicación para ayudarnos a mejorar el producto, rastrear fallas y problemas y reducir la fricción del producto. Los datos de la sesión pueden incluir interacciones de pantalla, información del dispositivo y ubicación aproximada. Las entradas de texto y los elementos sensibles de la interfaz de usuario se enmascaran automáticamente y nunca se capturan".*

2. **Grabación de puerta detrás del consentimiento** (recomendado para usuarios del EEE):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respete las exclusiones.** Si un usuario retira su consentimiento, deje de grabar y borre sus datos:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Captura de registros de consola

La captura de registros de la consola está habilitada de forma predeterminada (`trackConsoleLogs: true`). Los registros de la consola pueden contener PII según las prácticas de registro de su aplicación. Desactívelo si pueden aparecer datos confidenciales en los registros:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolocalización

La geolocalización derivada de IP (país, región, ciudad) se recopila de forma predeterminada. Cuando `collectGeoLocation` es `false`, SDK pasa una marca a la capa nativa que suprime la búsqueda de geolocalización de IP en el backend; no se almacenan datos de ubicación para esa sesión. Desactívelo si no necesita datos de ubicación o desea minimizar la recopilación de datos para los usuarios del EEE:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Hojas nativas

La captura de hojas nativas está habilitada de forma predeterminada (`captureNativeSheets: true`) para las versiones SDK compatibles. Esto permite que las hojas y cuadros de diálogo nativos propiedad de la aplicación, como los modales de autorización de pago, aparezcan en las repeticiones de depuración cuando el sistema operativo permite la captura. Las hojas del sistema de entrada de texto/teclado se excluyen cuando las entradas de texto están enmascaradas de forma predeterminada. Cuando el enmascaramiento de entrada de texto se configura solo para campos seguros, los teclados son solo de mejor esfuerzo y no se pueden capturar de manera confiable, especialmente cuando el sistema operativo los presenta como superficies protegidas o remotas. Las hojas compartidas del sistema operativo también son de mejor esfuerzo y no se pueden capturar de manera confiable cuando el sistema las presenta como superficies protegidas o remotas.

Desactive la captura de hojas nativas si desea que la reproducción visual permanezca limitada a la ventana principal de la aplicación:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Modo de sólo observación (sin grabación visual)

Para capturar errores, fallas, ANRs y actividad de red **sin** grabando repeticiones visuales, configure `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Cuando está habilitado, se recopila toda la telemetría, pero no se toman capturas de pantalla; las sesiones NO aparecerán en su página de repeticiones, pero habrá datos completos de análisis, errores, redes y fallos. Sin repetición. Esto es útil cuando los usuarios han optado por no participar en la grabación de pantalla pero aún desean visibilidad del error.

> **Nota:** Esto se puede configurar condicionalmente por usuario, por ejemplo, en función de una preferencia almacenada o un indicador de consentimiento:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```

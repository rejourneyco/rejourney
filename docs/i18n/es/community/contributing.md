# Contribuyendo a Rejourney

¡Agradecemos las contribuciones! Consulte las guías a continuación para comenzar.

## Estructura del proyecto

Este es un monorepo administrado por los espacios de trabajo npm.

## Requisitos previos

1. **Node.js** >= 18.0.0
2. **npm** o **yarn** (los espacios de trabajo funcionan con ambos)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode y CocoaPods
7. **Android**: Android Studio y JDK 17

## Configuración inicial

### 1. Instalar dependencias

Del **raíz** del monorepo:

```bash
npm install
```

Esto:
- Instalar todas las dependencias del espacio de trabajo
- Compile el paquete SDK automáticamente (ejecuta `npm run build:sdk` mediante el script `postinstall` en la raíz `package.json`)
- Vincular todos los paquetes correctamente

### 2. Construya el SDK

Si necesita reconstruir el SDK después de realizar cambios:

```bash
npm run build:sdk
```

O para una construcción limpia:

```bash
npm run build:clean
```

## Desarrollo de backend (Kubernetes local)

Rejourney utiliza `local-k8s/` para el desarrollo local, por lo que el tiempo de ejecución se mantiene cerca de la configuración de producción Kubernetes y al mismo tiempo mantiene rápido el ciclo diario.

### 1. Configurar `.env.k8s.local`

Copie la plantilla de entorno local Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Inicie la pila de desarrollo híbrido

```bash
npm run dev
```

Ese flujo:

- Crea un clúster `k3d` local si es necesario
- Se aplica `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` y `minio.yaml`.
- Sincroniza `.env.k8s.local` con los secretos de Kubernetes
- Ejecuta API, el panel y los trabajadores desde el origen en su máquina host.

Para una ejecución de paridad completa en el clúster:

```bash
npm run dev:full
```

Para detener la pila local:

```bash
npm run dev:down
```

### 3. Configuración de la dirección IP (prueba de dispositivos físicos)

Si está realizando pruebas en un **dispositivo físico** (iOS o Android) conectado al mismo WiFi, el SDK y el Tablero necesitan conocer la dirección IP local de su computadora para comunicarse.

#### Encontrar su dirección IP (Mac)

Ejecute el siguiente comando en su terminal:

```bash
ipconfig getifaddr en0
```

O encuéntrelo en **Configuración del sistema > WiFi > Detalles de [Su red]**.

#### Actualización `.env.k8s.local`

Las siguientes variables **DEBE** utilizan su dirección IP local (por ejemplo, `http://192.168.1.5:3000`) en lugar de `localhost`:

| Variables | Uso clave |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Acceso público a MinIO para repeticiones de vídeo |
| `PUBLIC_DASHBOARD_URL` | URL base para la interfaz de usuario del panel |
| `PUBLIC_API_URL` | URL base para API |
| `PUBLIC_INGEST_URL` | URL base para la ingesta de eventos SDK |
| `DASHBOARD_ORIGIN` | Origen CORS para el tablero |
| `OAUTH_REDIRECT_BASE` | URL base para devoluciones de llamadas de OAuth |




> [!IMPORTANT]
> Si no los configura correctamente, se producirán errores de "Conexión rechazada" en los dispositivos físicos o enlaces de imágenes/videos rotos en el panel.

`npm run dev` actualiza estos valores de LAN automáticamente a través de `scripts/local-k8s/update-ips.sh` y también escribe los archivos env de la aplicación de ejemplo utilizados por las aplicaciones Expo.

#### Configuración de ejemplo (`.env.k8s.local`)

Suponiendo que la dirección IP de su computadora es `192.168.1.100`:

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. Archivos locales Kubernetes

Los manifiestos locales Kubernetes reflejan intencionalmente el diseño de producción `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Ejecutar aplicaciones de ejemplo

### Modelo estándar React Native (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

O desde el directorio de ejemplo:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Laboratorios de preparación de café (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Desnudo

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Cómo funciona

### Configuración del espacio de trabajo

El monorepo utiliza espacios de trabajo npm para los paquetes principales, pero las aplicaciones de ejemplo son independientes:

1. **Raíz `package.json`** incluye solo `packages/*`, `backend` y `dashboard/web-ui` en espacios de trabajo
2. **Las aplicaciones de ejemplo son independientes**: tienen su propio `node_modules` para evitar conflictos de dependencia
3. **Aplicaciones de ejemplo** hace referencia a SDK usando `"rejourney": "file:../../packages/react-native"`
4. **Configuraciones de metro** están configurados para observar y resolver el paquete SDK correctamente

**Por qué los ejemplos no están en los espacios de trabajo:**
- Las aplicaciones de ejemplo utilizan diferentes versiones de Expo/React Native
- Previene conflictos de deduplicación de dependencia npm
- Cada ejemplo puede tener su propio árbol de dependencia completo.

### Configuración metropolitana

Cada aplicación de ejemplo tiene un `metro.config.js` que:

1. **Relojes** el directorio fuente SDK (`packages/react-native`) para cambios
2. **Resuelve** el paquete `rejourney` a la ubicación correcta
3. **Bloques** duplica los paquetes `react-native` y `react` desde la raíz del espacio de trabajo

### Codegen (TurboMódulos)

El codegen de React Native se ejecuta automáticamente al crear la aplicación si:

1. El `package.json` del SDK tiene definido el `codegenConfig` ✅
2. El archivo de especificaciones (`NativeRejourney.ts`) sigue la convención de nomenclatura ✅
3. La aplicación incluye el paquete SDK ✅

Codegen se ejecuta automáticamente durante:
- `npm run ios` (compilaciones iOS)
- `npm run android` (compilaciones Android)

## Estructura del proyecto

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD e implementación

Rejourney utiliza GitHub Actions para automatizar las pruebas, la creación y la implementación en todo el monorepo.

Para obtener un desglose detallado de nuestros conjuntos de pruebas, pruebas de integración nativa y lógica de implementación automatizada, consulte [CI/CD y documentación de pruebas](/docs/architecture/ci-cd).

---

Explore la [Comparación de arquitectura](/docs/architecture/distributed-vs-single-node) para obtener detalles sobre la nube (K8) frente a la autohospedada (Docker).

## Mejores prácticas

1. **Construya siempre el SDK** antes de la prueba: `npm run build:sdk`
2. **Usar protocolo de archivo** (`file:../../packages/react-native`) en package.json para espacios de trabajo npm
3. **Borrar caché de Metro** cuando tiene problemas: `npm start -- --reset-cache`
4. **Reconstruir aplicaciones nativas** después de cambios en el código nativo SDK
5. **Pruebe tanto en iOS como en Android** antes de comprometerse

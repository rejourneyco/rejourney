# CI/CD y pruebas automatizadas

Rejourney utiliza GitHub Actions para garantizar la calidad del código en todo el monorepo. Cada solicitud de extracción y envío a la rama principal desencadena una batería completa de pruebas.

## Conjuntos de pruebas

### 1. Pruebas de backend API
Ubicadas en el directorio `backend/`, estas pruebas garantizan que la lógica central y las interacciones de la base de datos sean estables.
* **pelusa**: utiliza ESLint para aplicar el estilo del código y detectar errores comunes.
* **Pruebas unitarias**: Desarrollado por Vitest, prueba la lógica de servicio, funciones de utilidad y controladores API.
* **Verificación de compilación**: garantiza que el código fuente TypeScript se compila correctamente en la distribución final.

### 2. Pruebas React Native SDK
Ubicadas en `packages/react-native/`, estas pruebas son fundamentales para la estabilidad multiplataforma.
* **TypeScript Verificar**: valida tipos en todo el SDK, detectando posibles discrepancias en el puente.
* **pelusa**: aplica una calidad de código consistente.
* **Verificación de compilación**: ejecuta el script de preparación para garantizar que el paquete se pueda empaquetar para su distribución.

### 3. Pruebas del panel web
Ubicado en `dashboard/web-ui/`, centrándose en la interfaz de usuario y SSR.
* **TypeScript Verificar**: Incluye generación de tipo React Router para garantizar la seguridad de la ruta.
* **Construcción SSR**: verifica que toda la aplicación Remix/React Router se puede crear para la renderización del lado del servidor.

---

## Pruebas de integración nativa
Una de las partes más sólidas de nuestro CI/CD es la validación del SDK en entornos de plataforma reales.

### Integración iOS (macos-último)
* **Instalación nueva**: El CI crea un nuevo proyecto React Native desde cero.
* **Inyección de paquetes**: agrupa el SDK local usando `npm pack` y lo instala en la aplicación de prueba.
* **Verificación CocoaPods**: ejecuta `pod install` para garantizar que las dependencias nativas y las especificaciones de pod estén vinculadas correctamente.
* **Verificación de compilación**: ejecuta `xcodebuild` para garantizar que la aplicación de prueba se compila correctamente con SDK integrado.

### Integración Android (ubuntu-último)
* **Instalación nueva**: similar a iOS, se inicializa un nuevo proyecto React Native basado en Android.
* **Verificación de compilación**: ejecuta `./gradlew assembleDebug` para garantizar que no haya conflictos de manifiesto ni errores de compilación en el código nativo Android.

---

## Lógica de implementación y publicación

### Implementación automatizada en la nube (VPS)
La implementación en nuestro entorno de producción está controlada por el control de versiones.
* **Verificación de versión**: un trabajo dedicado compara la versión raíz `package.json` con la confirmación anterior.
* **Activador condicional**: La implementación solo continúa si se ha incrementado la versión.
* **Implementación automatizada**: si se activa, aplica los manifiestos K8 más recientes y realiza un reinicio continuo de todas las implementaciones (api, web y trabajadores).

### Publicación automatizada SDK (NPM)
Mantenemos un flujo de publicación fluido para el paquete `rejourney`.
* **Ruta sensible**: solo se activa cuando se modifican los archivos dentro de `packages/react-native/`.
* **Verificación de registro**: compara la versión del paquete local con la última versión en el registro de NPM.
* **Publicación automática**: si la versión local es superior, publica automáticamente la nueva versión en NPM después de pasar todas las pruebas.

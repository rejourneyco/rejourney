# Autohospedaje Rejourney

Esta guía es para **alguien** que ejecuta Rejourney en su propio servidor (normalmente un único VPS o una máquina dedicada) utilizando la pila oficial **Docker Compose**. No necesita acceso a la infraestructura interna de Rejourney ni a Kubernetes.

Después de la configuración obtienes:

- Un **panel web** en su dominio (HTTPS vía Let’s Encrypt)
- Un **API** en un subdominio (para el tablero y el móvil SDK)
- Un **relé de ingesta (carga)** en otro subdominio (las cargas de sesiones pasan por su servidor, no directamente desde los teléfonos al almacenamiento de objetos)
- **PostgreSQL**, **Redis** y **incorporado MinIO** o **su propio almacenamiento S3-compatible**
- Antecedentes **trabajadores** que procesan sesiones, retención y alertas (las mismas funciones que en la implementación en la nube de Rejourney)

Todos los comandos siguientes suponen que se encuentra en **raíz del repositorio** después de la clonación (la carpeta que contiene `docker-compose.selfhosted.yml`).

---

## Lo que necesitas de antemano

### Servidor

- **SO:** Ubuntu 22.04+, Debian 12+ u otro Linux que ejecute bien Docker
- **Docker:** 24 ​​o posterior, con **Complemento Docker Compose** (`docker compose version` debería funcionar)
- **Recursos (recomendado):** 4 vCPU, 8 GB de RAM, 40 GB de disco (más si guardas muchas grabaciones)
- **Red:** Puertos **80** y **443** abiertos a Internet (requeridos para el desafío Let’s Encrypt HTTP y HTTPS)

### Dominio y DNS

Necesitas el **un dominio base** que controlas (por ejemplo, `example.com`). Antes de ejecutar el instalador, cree registros DNS **A** (o **AAAAA**) que apunten a **todo** de estos nombres de host a la IP pública de su servidor:

| Nombre de host | Propósito |
|----------|---------|
| `example.com` | Panel de control |
| `www.example.com` | Redirecciona al panel de control |
| `api.example.com` | API (y WebSocket cuando se utilice) |
| `ingest.example.com` | Cargar relé (SDK lo usa automáticamente una vez que se configura API) |

Reemplace `example.com` con su dominio real. La propagación puede tardar desde unos minutos hasta horas; Los certificados TLS no se emitirán hasta que DNS se resuelva correctamente.

### Let’s Encrypt

Se le pedirá un **dirección de correo electrónico** durante la instalación. Se utiliza para avisos de caducidad de certificados de Let’s Encrypt.

### Herramientas en tu máquina

- `git` para clonar el repositorio
- `openssl` (utilizado por el script de instalación para generar secretos)
- Un caparazón (bash está bien)

---

## Instalación por primera vez

### 1. Clonar el repositorio

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Permanezca en la rama predeterminada (o en una etiqueta de lanzamiento si el proyecto documenta una para autohospedaje).

### 2. Ejecute el instalador

```bash
./scripts/selfhosted/deploy.sh install
```

El guión:

1. Pregunte por su **dominio base** (por ejemplo, `example.com`, no `https://`, sin ruta).
2. Pregunta por tu **Correo electrónico Let’s Encrypt**.
3. Solicite **almacenamiento**: almacenamiento integrado **MinIO** (recomendado) o **externo S3-compatible** (ingresará el punto final, el depósito, la región y las claves).
4. Cree **`.env.selfhosted`** en la raíz del repositorio con contraseñas y secretos generados. Se aplican **Restringir permisos** (`chmod 600`).
5. Imágenes de contenedor publicadas **Jalar** (API, web, trabajadores, bases de datos, Traefik, etc.).
6. **Construir** la imagen **arranque/migración** **de tu clon** (contiene los scripts de configuración de la base de datos; no se descarga del registro del contenedor).
7. Inicie las bases de datos, Redis, Traefik y (si se elige) MinIO.
8. Valide la conectividad de la base de datos utilizando el `DATABASE_URL` configurado antes de ejecutar el arranque.
9. Ejecute un contenedor **oreja** de una sola vez: esquema de base de datos, inicialización opcional por primera vez y configuración de almacenamiento en la base de datos.
10. Inicie API, cargue el relé, el panel y los trabajadores.

La primera instalación puede tardar varios minutos (extracción de imágenes y arranque).

### 3. Proteger `.env.selfhosted`

Este archivo contiene **todos los secretos** para su implementación (base de datos, Redis, JWT, cifrado de almacenamiento, credenciales MinIO si se usan, etc.). **hacer una copia de seguridad** a un lugar seguro (administrador de contraseñas, copia de seguridad cifrada). Si lo pierde, puede perder la capacidad de descifrar las credenciales almacenadas o reconstruir la misma implementación.

No lo envíe a git (`.gitignore` debería ignorarlo).

---

## Después de la instalación

### URL

El instalador imprime las URL. En general:

- **Panel:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Ingerir:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` redirige al tablero.

### Verificar la pila

```bash
./scripts/selfhosted/deploy.sh status
```

Deberías ver contenedores ejecutándose; `api` y `ingest-upload` deberían convertirse en **saludable** después de un corto tiempo.

### Primer inicio de sesión y grabación de prueba

1. Abra el panel en un navegador.
2. Crea una cuenta y un proyecto.
3. Configure Rejourney SDK de su aplicación con su **URL API** (consulte [configuración SDK](#configuring-your-mobile-app) a continuación).
4. Graba una sesión corta y confirma que aparece en Replay.

Si las sesiones nunca aparecen en Replay, consulte [Solución de problemas](/docs/selfhosted/troubleshooting) (carga de retransmisión e ingesta de registros de trabajadores).

---

## Operaciones del día a día

Todos estos se ejecutan desde la raíz del repositorio.

| Acción | Comando |
|--------|---------|
| Estado del servicio | `./scripts/selfhosted/deploy.sh status` |
| Seguir todos los registros | `./scripts/selfhosted/deploy.sh logs` |
| Registros para un servicio | `./scripts/selfhosted/deploy.sh logs api` (reemplace `api` por `web`, `ingest-upload`, `ingest-worker`, etc.) |
| Imágenes **Mejora** y volver a ejecutar bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Detén todo **sin** eliminando datos | `./scripts/selfhosted/deploy.sh stop` |
| **Reiniciar** contenedores y volúmenes (destructivos) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** extrae imágenes más nuevas (cuando corresponda), reconstruye la imagen de arranque a partir de su clon actual, reinicia la pila y ejecuta el arranque nuevamente para que el esquema de la base de datos y la configuración de almacenamiento permanezcan alineados con su `.env.selfhosted`. Limpia **no** Postgres o volúmenes de almacenamiento de objetos.

Antes del arranque, tanto `install` como `update` validan la conectividad de la base de datos con las credenciales configuradas. Si las credenciales no coinciden con los datos persistentes de Postgres, la implementación se detiene temprano con orientación de recuperación en lugar de fallar más tarde en el arranque.

**`stop`** detiene contenedores únicamente; Docker **volúmenes** (datos Postgres, datos MinIO, etc.) permanecen hasta que los elimine explícitamente.

**`reset`** elimina los contenedores autohospedados y los volúmenes Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) después de un mensaje de confirmación. También derriba los contenedores de perfiles MinIO incluso cuando falta `.env.selfhosted`, por lo que los datos obsoletos de MinIO no bloquean la siguiente instalación. Úselo sólo cuando desee una instalación completamente nueva.

---

## Almacenamiento: MinIO frente a S3 externo

### MinIO incorporado (predeterminado)

- Lo más fácil para un solo servidor: el almacenamiento de objetos ejecuta **dentro Docker** y no está expuesto a la Internet pública de forma predeterminada.
- Los bytes de sesión los escribe el servicio **ingesta-carga**; Los dispositivos no necesitan llegar directamente a MinIO.
- La creación del depósito se gestiona durante la instalación.

### Almacenamiento externo S3-compatible

Utilice AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi o cualquier S3-compatible API. Durante la instalación, usted proporciona la URL del punto final, el depósito, la región y las claves de acceso.

Ejemplos de estilos de URL de punto final (los documentos de su proveedor tienen autoridad):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Si agrega un **URL pública separada** para descargas, configure `S3_PUBLIC_ENDPOINT` en `.env.selfhosted` y ejecute `./scripts/selfhosted/deploy.sh update`.

---

## Configuración importante (`.env.selfhosted`)

El instalador genera este archivo. Las variables típicas incluyen:

- **Dominios y URL públicas:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Base de datos:** `DATABASE_URL` (apunta al servicio `postgres` dentro de Compose)
- **Redis:** `REDIS_URL`
- **Almacenamiento:** `STORAGE_BACKEND`, `S3_*` y, opcionalmente, `MINIO_*`
- **Seguridad:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Integraciones opcionales (dejar en blanco si no se utilizan): Stripe, SMTP, GitHub OAuth, Turnstile, etc.

**Cambiar valores de almacenamiento o relacionados con el dominio:** edite `.env.selfhosted`, luego ejecute:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Cómo funciona la configuración de la base de datos (primer arranque versus actualizaciones posteriores)

Normalmente, **no** necesita ejecutar SQL manualmente. El contenedor **oreja** se encarga de ello.

- **Nueva base de datos vacía:** la pila aplica el esquema actual del código, luego registra qué versiones de migración ya se cumplen para que las actualizaciones futuras solo apliquen las migraciones **nuevo**.
- **Base de datos existente (ya inicializada):** solo se aplican migraciones **pendiente**. Sus datos no se reconstruyen desde cero en cada `update`.
- Si la base de datos **ya tiene mesas** pero la tabla del historial de migración es **faltante o vacío** (por ejemplo, una restauración parcial), inicie **se detiene con un error** para evitar daños accidentales. Las opciones de recuperación avanzadas están documentadas en [Solución de problemas](/docs/selfhosted/troubleshooting).

---

## Servidores Apple Silicon y ARM

En las máquinas **ARM64** (muchas Mac, algunas instancias en la nube), el script de implementación configura `DOCKER_DEFAULT_PLATFORM=linux/amd64` para la extracción de imágenes cuando usted no lo ha configurado usted mismo, por lo que aún se ejecutan las imágenes prediseñadas que solo publican `amd64`. Si necesita un comportamiento diferente, configure `DOCKER_DEFAULT_PLATFORM` en su entorno antes de ejecutar el script.

La imagen **oreja** siempre es **construido en su máquina** del repositorio clonado, por lo que siempre coincide con su pago.

---

## Qué se ejecuta en Docker (descripción general)

- Certificados **Traefik:** HTTPS y enrutamiento al panel, API, y nombres de host de ingesta.
- **Postgres / Redis:** Datos y colas de aplicaciones.
- **MinIO:** Almacenamiento de objetos interno opcional.
- **API:** Principal HTTP API.
- **ingesta-carga:** Servicio dedicado para el tráfico de retransmisión de carga.
- **web:** Interfaz de usuario estática del panel.
- **Trabajadores:** Colas de ingesta de procesos, artefactos de reproducción, ciclo de vida de sesiones, trabajo de estilo de retención programado y alertas.

Hay un trabajador por lotes de facturación independiente **No** en esta pila; La integración de facturación está impulsada por Stripe y API cuando configura claves.

---

## Configurando tu aplicación móvil

Apunte el SDK al host **su** API (debe coincidir con `API_DOMAIN` / `PUBLIC_API_URL`).

### Ejemplo de React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Utilice su URL API real. Las URL de carga se derivan para `ingest.<your-domain>` automáticamente cuando el servidor está configurado correctamente.

---

## Copias de seguridad

Como mínimo, haga una copia de seguridad de **PostgreSQL**, **`.env.selfhosted`** y (si utiliza el MinIO integrado) **datos de almacenamiento de objetos**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Detalles: [Copia de seguridad y recuperación](/docs/selfhosted/backup-recovery).

---

## Solución de problemas y soporte

- [Solución de problemas](/docs/selfhosted/troubleshooting): fallas de arranque, TLS, reproducción vacía, problemas externos con S3.
- [Copia de seguridad y recuperación](/docs/selfhosted/backup-recovery): orden de restauración y MinIO.

Para detectar errores o mejoras en estos documentos, utilice el rastreador de problemas públicos del proyecto en GitHub.

---

## Documentación relacionada

- [Nube distribuida versus nube de nodo único](/docs/distributed-vs-single-node/distributed-vs-single-node): comparación con un diseño de nube multiservicio (conceptual).

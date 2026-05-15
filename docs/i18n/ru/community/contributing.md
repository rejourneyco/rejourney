# Содействие Rejourney

Мы приветствуем вклады! Чтобы начать, ознакомьтесь с руководствами ниже.

## Структура проекта

Это монорепозиторий, управляемый рабочими пространствами npm.

## Предварительные условия

1. **Node.js** >= 18.0.0
2. **npm** или **yarn** (рабочие пространства работают с обоими)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode и CocoaPods
7. **Android**: Android Studio и JDK 17

## Начальная настройка

### 1. Установите зависимости

Из **корень** монорепозитория:

```bash
npm install
```

Это будет:
- Установите все зависимости рабочей области
- Автоматически собрать пакет SDK (запускает `npm run build:sdk` через скрипт `postinstall` в корне `package.json`)
- Правильно свяжите все пакеты

### 2. Создайте SDK.

Если вам нужно пересобрать SDK после внесения изменений:

```bash
npm run build:sdk
```

Или для чистой сборки:

```bash
npm run build:clean
```

## Бэкэнд-разработка (локальный Kubernetes)

Rejourney использует `local-k8s/` для локальной разработки, поэтому среда выполнения остается близкой к производственной настройке Kubernetes, сохраняя при этом скорость ежедневного цикла.

### 1. Настройте `.env.k8s.local`.

Скопируйте локальный шаблон среды Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Запустите гибридный стек разработчиков

```bash
npm run dev
```

Этот поток:

- При необходимости создает локальный кластер `k3d`.
- Применяется `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` и `minio.yaml`.
- Синхронизирует `.env.k8s.local` с секретами Kubernetes.
- Запускает API, панель мониторинга и рабочие процессы из исходного кода на вашем хост-компьютере.

Для полной проверки четности внутри кластера:

```bash
npm run dev:full
```

Чтобы остановить локальный стек:

```bash
npm run dev:down
```

### 3. Конфигурация IP-адреса (тестирование физического устройства)

Если вы проводите тестирование на **физическое устройство** (iOS или Android), подключенном к одному и тому же Wi-Fi, SDK и Dashboard для связи должны знать локальный IP-адрес вашего компьютера.

#### Поиск вашего IP-адреса (Mac)

Запустите следующую команду в своем терминале:

```bash
ipconfig getifaddr en0
```

Или найдите его в **Системные настройки > Wi-Fi > [Ваша сеть] Подробности**.

#### Обновление `.env.k8s.local`

Следующие переменные **ДОЛЖЕН** используют ваш локальный IP-адрес (например, `http://192.168.1.5:3000`) вместо `localhost`:

| Переменная | Ключевое использование |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Публичный доступ к MinIO для видеоповторов |
| `PUBLIC_DASHBOARD_URL` | Базовый URL-адрес пользовательского интерфейса информационной панели |
| `PUBLIC_API_URL` | Базовый URL-адрес для API |
| `PUBLIC_INGEST_URL` | Базовый URL-адрес для приема событий SDK |
| `DASHBOARD_ORIGIN` | Происхождение CORS для приборной панели |
| `OAUTH_REDIRECT_BASE` | Базовый URL-адрес для обратных вызовов OAuth |




> [!IMPORTANT]
> Неправильная установка этих параметров приведет к появлению ошибок «Отказ в соединении» на физических устройствах или неработающим ссылкам на изображения/видео на панели управления.

`npm run dev` автоматически обновляет эти значения для локальной сети через `scripts/local-k8s/update-ips.sh`, а также записывает примеры файлов env приложений, используемых приложениями Expo.

#### Пример конфигурации (`.env.k8s.local`)

Предполагая, что IP-адрес вашего компьютера — `192.168.1.100`:

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

### 4. Локальные файлы Kubernetes.

Локальные манифесты Kubernetes намеренно отражают производственный макет `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Запуск примеров приложений

### React Native Шаблон (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Или из каталога примеров:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Brew Coffee Labs (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Голый

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Как это работает

### Настройка рабочего пространства

Монорепозиторий использует рабочие области npm для основных пакетов, но примеры приложений являются автономными:

1. **Корень `package.json`** включает в рабочие области только `packages/*`, `backend` и `dashboard/web-ui`.
2. **Примеры приложений являются автономными** — у них есть свой `node_modules`, чтобы избежать конфликтов зависимостей.
3. **Примеры приложений** ссылается на SDK, используя `"rejourney": "file:../../packages/react-native"`
4. **Конфигурации метро** настроены для правильного просмотра и разрешения пакета SDK.

**Почему примеров нет в рабочих областях:**
- Примеры приложений используют разные версии Expo/React Native.
- Предотвращает конфликты дедупликации зависимостей npm.
- Каждый пример может иметь собственное полное дерево зависимостей.

### Конфигурация метро

В каждом примере приложения есть `metro.config.js`, который:

1. **Часы** исходный каталог SDK (`packages/react-native`) для изменений.
2. **Решает** пакет `rejourney` в правильное место.
3. **Блоки** дубликаты пакетов `react-native` и `react` из корня рабочей области.

### Кодеген (ТурбоМодули)

Генератор кода React Native автоматически запускается при сборке приложения, если:

1. `package.json` SDK имеет определение `codegenConfig` ✅
2. Файл спецификации (`NativeRejourney.ts`) соответствует соглашению об именах ✅
3. Приложение включает в себя пакет SDK ✅

Codegen запускается автоматически во время:
- `npm run ios` (сборки iOS)
- `npm run android` (сборки Android)

## Структура проекта

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

## CI/CD и развертывание

Rejourney использует GitHub Actions для автоматизации тестирования, сборки и развертывания во всем монорепозитории.

Подробное описание наших наборов тестов, встроенного интеграционного тестирования и логики автоматического развертывания см. в [CI/CD и документации по тестированию](/docs/architecture/ci-cd).

---

Изучите [Сравнение архитектур](/docs/architecture/distributed-vs-single-node) для получения подробной информации об облаке (K8s) и самостоятельном размещении (Docker).

## Лучшие практики

1. **Всегда собирайте SDK.** перед тестированием: `npm run build:sdk`
2. **Использовать файловый протокол** (`file:../../packages/react-native`) в package.json для рабочих областей npm
3. **Очистить кеш Метро** при возникновении проблем: `npm start -- --reset-cache`
4. **Пересоберите собственные приложения** после изменений собственного кода SDK
5. **Протестируйте как iOS, так и Android.** перед фиксацией

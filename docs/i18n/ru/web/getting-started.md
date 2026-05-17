<!-- AI_PROMPT_SECTION -->
**Используете Cursor, Claude или ChatGPT?** Скопируйте запрос на интеграцию и вставьте его в помощник AI, чтобы автоматически сгенерировать код установки.

<!-- /AI_PROMPT_SECTION -->

## Установка

Добавьте пакет Rejourney в свой проект, используя npm или yarn.

```bash
npm install @rejourneyco/browser
```

## Базовая настройка

Инициализируйте и запустите Rejourney в точке входа вашего приложения.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` извлекает удаленную конфигурацию вашего проекта и подготавливает SDK. `start` начинает сеанс, регистрирует посетителя и (если включено воспроизведение) запускает rrweb-рекордер. Оба являются асинхронными, и их можно безопасно вызывать без ожидания, если вам не нужно ничего блокировать по завершении.




> [!NOTE]
> `autoStart` по умолчанию — `false`. Вы должны явно вызвать `start()`, что позволит вам разрешить запись после проверки согласия. Для автоматического запуска после `init` введите `{ autoStart: true }`.

### Интеграция фреймворков

В пакет входят выделенные точки входа для популярных фреймворков. Используйте тот, который соответствует вашему стеку, или используйте ванильный API, указанный выше, из любого фреймворка.

---

#### Реагировать

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

`startOnMount` по умолчанию имеет значение `false` на `RejourneyProvider`. Передайте `startOnMount` (или `startOnMount={true}`), чтобы начать запись, как только компонент смонтируется.

---

#### Next.js

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

`RejourneyNext` — это компонент `'use client'`, который отображает `null`. `startOnMount` по умолчанию равен `true`. Изменения маршрута отслеживаются автоматически через историю API.

---

#### Вю

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

Экземпляр Rejourney доступен через `app.config.globalProperties.$rejourney` и через `inject('rejourney')`. Для удобства компонуемый элемент `useRejourney()` также экспортируется.

---

#### Нукст

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Суффикс `.client.ts` гарантирует, что этот плагин будет работать только в браузере. Экземпляр Rejourney внедряется как `$rejourney` и доступен через `useNuxtApp().$rejourney`.

---

#### Свелте / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` возвращает функцию очистки, которая вызывает `Rejourney.stop()` — возвращаемое значение Svelte `onMount` автоматически используется в качестве обратного вызова уничтожения.

---

#### Угловой

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

`createRejourneyAppInitializer` возвращает фабрику, которая инициализирует и запускает Rejourney на этапе начальной загрузки Angular. Вы также можете внедрить `RejourneyService` для API на основе класса.

---

#### Ремикс

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

`startOnMount` по умолчанию равен `true`. Изменения маршрута отслеживаются автоматически.

---

#### Астро

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` не работает в средах SSR — перед запуском проверяется наличие `window`.

---

## Настройки удаленной записи

Настройки проекта могут управлять настройками веб-записи по умолчанию без развертывания кода. SDK считывает удаленную конфигурацию при каждом вызове `start()`. Удаленная конфигурация может полностью включить или отключить запись, настроить список разрешенных доменов и установить максимальную продолжительность сеанса. Если удаленная конфигурация недоступна, `start()` не продолжит работу — это сделано для предотвращения записи в неизвестном состоянии проекта.

## Отслеживание маршрута

Rejourney автоматически отслеживает изменения страниц и маршрутов, поэтому вы можете видеть контекст навигации в повторах. Это включено по умолчанию (`autoTrackRoutes: true`) и работает путем перехвата вызовов History API (`pushState`, `replaceState`) и прослушивания событий `popstate`.

### Пользовательские имена маршрутов

По умолчанию в качестве имени экрана используется текущий `window.location.pathname`. Чтобы обеспечить собственную логику именования, передайте функцию `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Ручное отслеживание экрана

Чтобы отслеживать экраны вручную (например, для смены вкладок или переходов между представлениями на странице), вызовите `trackScreen` напрямую:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Чтобы отключить автоматическое отслеживание маршрутов и полагаться исключительно на ручные вызовы:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Идентификация пользователя

Свяжите сеансы со своими внутренними идентификаторами пользователей, чтобы фильтровать и искать конкретных пользователей на панели мониторинга.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Конфиденциальность:** Используйте внутренние идентификаторы или UUID. Если вам необходимо использовать PII (электронная почта, телефон), хэшируйте его перед отправкой.

## Пользовательские события

Отслеживайте значимые действия пользователя, чтобы понять модели поведения, проблемы отладки и фильтровать повторы сеансов на панели мониторинга.

### Основное использование

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

| Параметр | Тип | Требуется | Описание |
|---|---|---|---|
| `name` | `string` | Да | Имя события — для согласованности используйте `snake_case` |
| `properties` | `object` | Нет | Пары ключ-значение, привязанные к этому конкретному событию |

### Примеры

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

### Как события появляются на информационной панели

Пользовательские события сохраняются для каждого сеанса и отображаются в двух местах:

1. **Хронология воспроизведения сеанса** — события отображаются в виде маркеров на временной шкале воспроизведения, поэтому вы можете перейти к точному моменту, когда произошло действие.
2. **Фильтры архива сеансов** — Фильтровать список сеансов по:
   - **Название события** — найти все сеансы, содержащие определенное событие (например, `purchase_completed`).
   - **Свойство события** — дальнейшее сужение по ключу и/или значению свойства (например, `plan = pro`)
   - **Количество событий** — найти сеансы с определенным количеством пользовательских событий (например, более 5 событий).

### Лучшие практики




> [!TIP]
> - Используйте согласованное именование (`snake_case`, например `button_clicked`, а не `Button Clicked`).
> - Сохраняйте значения свойств простыми (строки, числа, логические значения) — избегайте вложенных объектов.
> - Сосредоточьтесь на действиях, которые важны для отладки или аналитики — не записывайте все.
> - Свойства предназначены для контекста каждого события. Для атрибутов уровня сеанса вместо этого используйте **Метаданные**.

---

## Метаданные

Прикрепите пары «ключ-значение» на уровне сеанса, которые описывают контекст пользователя или сеанса. В отличие от событий, метаданные задаются один раз для каждого ключа и применяются ко всему сеансу.

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

Значения метаданных должны быть `string`, `number` или `boolean`. Объекты и массивы не принимаются.

### Когда использовать метаданные или события

| Вариант использования | Используйте **Метаданные** | Используйте **События** |
|---|---|---|
| План подписки пользователя | `setMetadata('plan', 'pro')` | |
| Пользователь нажал кнопку | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Вариант A/B-тестирования | `setMetadata('ab_variant', 'v2')` | |
| Покупка завершена | | `logEvent('purchase', { amount: 29 })` |
| Роль пользователя | `setMetadata('role', 'admin')` | |
| Достигнут этап адаптации | | `logEvent('onboarding_step', { step: 3 })` |

**Эмпирическое правило:** Если оно описывает *кто пользователь* или *в каком состоянии он находится*, используйте метаданные. Если оно описывает *что-то, что произошло*, используйте события.

## Контроль конфиденциальности

По умолчанию все текстовые вводы замаскированы (`maskAllInputs: true`). Замаскированные поля отображаются в повторах как пустые входные данные, и значения никогда не фиксируются в источнике. Пароль, адрес электронной почты, телефон и другие конфиденциальные типы ввода всегда маскируются независимо от этого параметра.

### Блокирующие элементы

Чтобы полностью исключить элемент DOM из повторов (он отображается в виде сплошного заполнителя), добавьте одно из следующих:

- Класс CSS: `rr-block`
- Атрибут данных: `data-rj-block` или `data-rejourney-block`.
- Пользовательский селектор CSS через параметр конфигурации `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Маскирование текста

Чтобы замаскировать текстовое содержимое элемента (текст заменяется, но форма элемента остается видимой), добавьте одно из следующих:

- Класс CSS: `rr-mask`
- Атрибут данных: `data-rj-mask`, `data-rejourney-mask`, `data-private` или любой `data-testid`, содержащий `"password"`.
- Пользовательский селектор CSS через параметр конфигурации `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Игнорирование элементов

Чтобы зафиксировать форму элемента, но подавить все события взаимодействия с ним (щелчки, вводы), добавьте:

- Класс CSS: `rr-ignore`
- Атрибут данных: `data-rj-ignore` или `data-rejourney-ignore`.

### Пользовательские функции маскировки

Для логики программного маскирования используйте `maskInputFn` или `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Согласие пользователя и GDPR




> [!IMPORTANT]
> **Вы являетесь Контроллером данных.** Rejourney выступает в качестве обработчика данных от вашего имени. Вы несете ответственность за то, чтобы ваши конечные пользователи были проинформированы о записи сеанса и что у вас есть действительная правовая основа для обработки их данных (например, согласие или законные интересы).

#### Что ты должен сделать

1. **Раскройте запись сеанса в своей политике конфиденциальности.** Включите такие языки, как:

   > * "Мы используем Rejourney для записи анонимных и неанонимных повторов сеансов вашей активности на нашем веб-сайте, чтобы помочь нам улучшить продукт и уменьшить трения. Данные сеанса могут включать взаимодействия со страницами, информацию о браузере и приблизительное местоположение. Ввод текста и конфиденциальные элементы автоматически маскируются и никогда не фиксируются."*

2. **Запись ворот после согласия** (рекомендуется для пользователей ЕЭЗ):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Уважайте возможность отказа.** Если пользователь отзовет согласие, прекратите запись и очистите свою личность:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Подробное согласие через `setConsent`

Для более точного контроля используйте `setConsent` для независимого переключения аналитики и воспроизведения:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Совместная установка `analytics: false` и `replay: false` останавливает сеанс и очищает все данные в очереди. Установка только `replay: false` останавливает рекордер rrweb, но продолжает отслеживать события.

#### Захват журнала консоли

Захват журнала консоли отключен по умолчанию (`trackConsoleLogs: false`). Включайте его только в том случае, если вам это необходимо, поскольку журналы консоли могут содержать PII в зависимости от ваших методов ведения журналов:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Геолокация

Геолокация на основе IP (страна, регион, город) собирается по умолчанию. Если `collectGeoLocation` — `false`, SDK передает флаг, который подавляет поиск геолокации IP на серверной стороне — для этого сеанса данные о местоположении не сохраняются:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Режим только наблюдения (без визуальной записи)

Чтобы фиксировать ошибки, длительные задачи, сетевую активность и аналитику **без**, записывающую визуальные повторы, установите `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Если эта функция включена, вся телеметрия собирается, но запись rrweb не запускается — сеансы не будут отображаться на вашей странице повторов, но полная аналитика, ошибки и сетевые данные по-прежнему будут записываться. Полезно, когда пользователь отказался от визуальной записи, но вам все равно нужна возможность наблюдения.

> **Примечание:** Вы можете установить это условно для каждого пользователя, например, на основе сохраненных предпочтений согласия:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Обнаружение ботов

Боты и автоматизированные браузеры по умолчанию игнорируются (`ignoreBots: true`). Playwright, Puppeteer, Selenium и другие клиенты на основе веб-драйверов подавляются. Чтобы записать сеансы автоматизации (например, для внутренних инструментов):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Чтобы предоставить собственный шаблон обнаружения ботов:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Захват сетевых запросов

Сетевые запросы (выборка и XHR) перехватываются и протоколируются по умолчанию (`autoTrackNetwork: true`). По умолчанию размеры тела запроса и ответа составляют **нет** (`networkCaptureSizes: false`). URL-адреса, методы, коды состояния и продолжительность всегда фиксируются.

Чтобы исключить определенные URL-адреса:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Чтобы отфильтровать или отредактировать запросы перед их отправкой:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Справочник по конфигурации

| Вариант | Тип | По умолчанию | Описание |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Вызов `start()` автоматически после завершения `init()` |
| `disableInDev` | `boolean` | `false` | Подавить запись на `localhost` и `127.0.0.1` |
| `debug` | `boolean` | `false` | Включить подробное ведение журнала SDK в консоли браузера |
| `enabled` | `boolean` | `true` | Главный переключатель уничтожения — установите значение `false`, чтобы предотвратить любую запись |
| `observeOnly` | `boolean` | `false` | Захват аналитики/ошибок/сети без визуального воспроизведения |
| `captureReplay` | `boolean` | `true` | Включить захват визуального повтора rrweb |
| `allowedDomains` | `string[]` | `[]` | Ограничить запись определенными доменами. Пусто означает, что разрешены все домены. Поддерживает подстановочные знаки `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Максимальная продолжительность сеанса в миллисекундах (по умолчанию: 30 минут) |
| `collectGeoLocation` | `boolean` | `true` | Собрать страну/регион/город на основе IP |
| `captureAttribution` | `boolean` | `true` | Захват параметров UTM, реферера и URL-адреса записи при запуске сеанса |
| `ignoreBots` | `boolean` | `true` | Подавить запись для обнаруженных ботов и веб-драйверов |
| `recordAutomation` | `boolean` | `false` | Разрешить запись сессий Драматурга/Кукловода/Селениума |
| `autoTrackRoutes` | `boolean` | `true` | Автоматически отслеживать изменения маршрута с помощью истории API |
| `routeName` | `(location: Location) => string` | — | Пользовательская функция для получения имени экрана из `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Перехват и регистрация запросов выборки/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL-адреса, которые следует исключить из сетевого отслеживания |
| `networkCaptureSizes` | `boolean` | `false` | Включить размеры тела запроса/ответа в сетевые журналы |
| `trackConsoleLogs` | `boolean` | `false` | Захватить вывод `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Обнаружение и протоколирование длительных задач (блоки потоков JS > 50 мс) |
| `trackResourceErrors` | `boolean` | `true` | Захват неудачных загрузок ресурсов (изображений, скриптов, таблиц стилей) |
| `maskAllInputs` | `boolean` | `true` | Маскировать все значения ввода текста в повторах |
| `blockClass` | `string \| RegExp` | `'rr-block'` | CSS-класс для полной блокировки воспроизведения элемента |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | CSS-селектор для полной блокировки элементов при воспроизведении |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | CSS-класс для игнорирования событий взаимодействия с элементом |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | CSS-селектор для игнорирования событий взаимодействия |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | CSS-класс для маскировки текстового содержимого при воспроизведении |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | CSS-селектор для маскировки текстового содержимого |
| `maskInputFn` | `(value, element) => string` | — | Пользовательская функция для преобразования входных значений перед захватом |
| `maskTextFn` | `(text, element) => string` | — | Пользовательская функция для преобразования текстового содержимого перед захватом |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Пользовательская функция для определения необходимости записи для каждой загрузки страницы |
| `beforeSendEvent` | `(event) => event \| null` | — | Фильтруйте или изменяйте события до того, как они будут поставлены в очередь. Верните `null` в дроп |
| `beforeSendNetwork` | `(request) => request \| null` | — | Фильтруйте или изменяйте записи сети до того, как они будут поставлены в очередь. Верните `null` в дроп |
| `onAuthError` | `(error) => void` | — | Вызывается, когда SDK не проходит аутентификацию на бэкэнде |

## Остановка записи

Вызовите `stop()`, чтобы завершить сеанс, очистить все ожидающие события и очистить все прослушиватели SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` безопасно вызывать несколько раз. После остановки снова вызовите `start()`, чтобы начать новый сеанс.

## Идентификатор сеанса

Получите доступ к текущему идентификатору сеанса, чтобы сопоставить сеансы Rejourney с вашими собственными журналами или инструментами поддержки:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Возвращает `null`, если ни один сеанс не активен.

## Помощники по статусу

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```

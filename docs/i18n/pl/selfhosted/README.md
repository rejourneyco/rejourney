# Samodzielny hosting Rejourney

Ten przewodnik dotyczy **ktokolwiek** uruchamiającego Rejourney na własnym serwerze (zwykle pojedynczy VPS lub maszyna dedykowana) przy użyciu oficjalnego stosu **Docker Compose**. Nie potrzebujesz dostępu do wewnętrznej infrastruktury Rejourney ani Kubernetes.

Po konfiguracji otrzymasz:

- **panel internetowy** w Twojej domenie (HTTPS przez Let’s Encrypt)
- **API** w subdomenie (dla pulpitu nawigacyjnego i telefonu komórkowego SDK)
- **przekaźnik pobierania (przesyłania).** w innej subdomenie (przesyłanie sesji przechodzi przez Twój serwer, a nie bezpośrednio z telefonów do pamięci obiektowej)
- **PostgreSQL**, **Redis** i **wbudowany MinIO** lub **własną pamięć masową S3-compatible**
- Tło **pracownicy**, które przetwarza sesje, przechowywanie i alerty (te same role, co we wdrożeniu chmury Rejourney)

Wszystkie poniższe polecenia zakładają, że po sklonowaniu znajdujesz się w **katalog główny repozytorium** (folder zawierający `docker-compose.selfhosted.yml`).

---

## Czego potrzebujesz wcześniej

### Serwer

- **System operacyjny:** Ubuntu 22.04+, Debian 12+ lub inny Linux, który dobrze działa Docker
- **Docker:** 24 ​​lub nowszy, z **Wtyczka Docker Compose** (`docker compose version` powinien działać)
- **Zasoby (zalecane):** 4 vCPU, 8 GB RAM, 40 GB dysku (więcej przy dużej liczbie nagrań)
- **Sieć:** Porty **80** i **443** otwarte na Internet (wymagane w przypadku wyzwania Let’s Encrypt HTTP i HTTPS)

### Domena i DNS

Potrzebujesz **jedna domena bazowa**, którym sterujesz (na przykład `example.com`). Przed uruchomieniem instalatora utwórz rekordy DNS **A** (lub **AAAA**) wskazujące **Wszystko** tych nazw hostów na publiczny adres IP Twojego serwera:

| Nazwa hosta | Cel |
|----------|---------|
| `example.com` | Panel |
| `www.example.com` | Przekierowuje do panelu |
| `api.example.com` | API (i WebSocket, jeśli jest używany) |
| `ingest.example.com` | Przekaźnik przesyłania (SDK używa tego automatycznie po skonfigurowaniu API) |

Zamień `example.com` na swoją prawdziwą domenę. Rozmnażanie może zająć od kilku minut do godzin; Certyfikaty TLS nie zostaną wydane, dopóki DNS nie zostanie poprawnie rozwiązany.

### Let’s Encrypt

Podczas instalacji zostaniesz poproszony o **adres e-mail**. Służy do powiadamiania o wygaśnięciu certyfikatu z Let’s Encrypt.

### Narzędzia na Twojej maszynie

- `git`, aby sklonować repozytorium
- `openssl` (używany przez skrypt instalacyjny do generowania kluczy tajnych)
- Powłoka (bash jest w porządku)

---

## Instalacja po raz pierwszy

### 1. Sklonuj repozytorium

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Pozostań w gałęzi domyślnej (lub znaczniku wydania, jeśli projekt dokumentuje taki do samodzielnego hostowania).

### 2. Uruchom instalator

```bash
./scripts/selfhosted/deploy.sh install
```

Skrypt będzie:

1. Poproś o swój **domena bazowa** (np. `example.com` — nie `https://`, brak ścieżki).
2. Poproś o **E-mail Let’s Encrypt**.
3. Zapytaj o **składowanie**: wbudowaną pamięć **MinIO** (zalecane) lub **zewnętrzny S3-compatible** (wprowadzisz punkt końcowy, segment, region i klucze).
4. Utwórz **`.env.selfhosted`** w katalogu głównym repozytorium z wygenerowanymi hasłami i sekretami. Stosowane są **Ogranicz uprawnienia** (`chmod 600`).
5. **Ciągnąć** opublikował obrazy kontenerów (API, sieć, pracownicy, bazy danych, Traefik itp.).
6. **Zbudować** obraz **bootstrap/migracja** **z twojego klona** (zawiera skrypty konfigurujące bazę danych; nie jest pobierany z rejestru kontenerów).
7. Uruchom bazy danych, Redis, Traefik i (jeśli wybrano) MinIO.
8. Przed uruchomieniem ładowania początkowego sprawdź łączność z bazą danych przy użyciu skonfigurowanego `DATABASE_URL`.
9. Uruchom jednorazowy kontener **bootstrap**: schemat bazy danych, opcjonalny pierwszy start i konfiguracja magazynu w bazie danych.
10. Uruchom API, prześlij przekaźnik, pulpit nawigacyjny i pracowników.

Pierwsza instalacja może zająć kilka minut (pobieranie obrazu i ładowanie).

### 3. Chroń `.env.selfhosted`

Ten plik zawiera **wszystkie tajemnice** dla Twojego wdrożenia (baza danych, Redis, JWT, szyfrowanie pamięci, poświadczenia MinIO, jeśli są używane itp.). **Wykonaj kopię zapasową** w bezpieczne miejsce (menedżer haseł, zaszyfrowana kopia zapasowa). Jeśli je zgubisz, możesz utracić możliwość odszyfrowania przechowywanych poświadczeń lub zrekonstruowania tego samego wdrożenia.

Nie przypisuj tego do git (powinno to zostać zignorowane przez `.gitignore`).

---

## Po instalacji

### Adresy URL

Instalator wydrukuje adresy URL. Zazwyczaj:

- **Panel:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Łykać:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` przekierowuje do pulpitu nawigacyjnego.

### Sprawdź stos

```bash
./scripts/selfhosted/deploy.sh status
```

Powinieneś zobaczyć działające kontenery; `api` i `ingest-upload` powinny po krótkim czasie zmienić się w **zdrowy**.

### Pierwsze logowanie i nagranie testowe

1. Otwórz panel kontrolny w przeglądarce.
2. Utwórz konto i projekt.
3. Skonfiguruj Rejourney SDK swojej aplikacji za pomocą **Adres URL API** (patrz [konfiguracja SDK](#configuring-your-mobile-app) poniżej).
4. Nagraj krótką sesję i potwierdź, że pojawia się w powtórce.

Jeśli sesje nigdy nie pojawiają się w powtórce, zobacz [Rozwiązywanie problemów](/docs/selfhosted/troubleshooting) (prześlij dzienniki przekaźnika i pobierz dzienniki robocze).

---

## Codzienne operacje

Wszystkie działają z katalogu głównego repo.

| Akcja | Polecenie |
|--------|---------|
| Stan usługi | `./scripts/selfhosted/deploy.sh status` |
| Śledź wszystkie logi | `./scripts/selfhosted/deploy.sh logs` |
| Logi dla jednej usługi | `./scripts/selfhosted/deploy.sh logs api` (zamień `api` na `web`, `ingest-upload`, `ingest-worker` itp.) |
| Obrazy **Aktualizacja** i ponowne uruchomienie bootstrapu | `./scripts/selfhosted/deploy.sh update` |
| Zatrzymaj wszystko **bez** usuwanie danych | `./scripts/selfhosted/deploy.sh stop` |
| **Nastawić** pojemniki i objętości (niszczące) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** pobiera nowsze obrazy (jeśli ma to zastosowanie), odbudowuje obraz ładowania początkowego z bieżącego klonu, ponownie uruchamia stos i ponownie uruchamia ładowanie, aby schemat bazy danych i ustawienia przechowywania pozostały zgodne z Twoim `.env.selfhosted`. Czyści **nie** Postgres lub woluminy pamięci obiektów.

Przed rozpoczęciem ładowania zarówno `install`, jak i `update` sprawdzają łączność z bazą danych przy użyciu skonfigurowanych poświadczeń. Jeśli poświadczenia nie są zgodne z utrwalonymi danymi Postgres, wdrożenie zostanie zatrzymane wcześniej ze wskazówkami dotyczącymi odzyskiwania, zamiast później zakończyć się niepowodzeniem podczas ładowania początkowego.

**`stop`** zatrzymuje tylko kontenery; Docker **kłęby** (dane Postgres, dane MinIO itp.) pozostają do czasu ich wyraźnego usunięcia.

**`reset`** usuwa kontenery hostowane samodzielnie i woluminy Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) po wyświetleniu monitu o potwierdzenie. Niszczy także kontenery profili MinIO, nawet jeśli brakuje `.env.selfhosted`, więc nieaktualne dane MinIO nie blokują kolejnej instalacji. Używaj tej opcji tylko wtedy, gdy chcesz całkowicie nową instalację.

---

## Pamięć masowa: MinIO vs zewnętrzna S3

### Wbudowany MinIO (domyślnie)

- Najłatwiej w przypadku pojedynczego serwera: pamięć obiektowa działa na **wewnątrz Docker** i domyślnie nie jest dostępna w publicznym Internecie.
- Bajty sesji są zapisywane przez usługę **pobieranie-przesyłanie**; urządzenia nie muszą bezpośrednio łączyć się z MinIO.
- Tworzenie zasobnika jest obsługiwane podczas instalacji.

### Zewnętrzna pamięć masowa S3-compatible

Użyj AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi lub dowolnego S3-compatible API. Podczas instalacji podajesz adres URL punktu końcowego, segment, region i klucze dostępu.

Przykłady stylów adresów URL punktów końcowych (dokumentacja Twojego dostawcy jest wiarygodna):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Jeśli dodasz **oddzielny publiczny adres URL** do pobierania, ustaw `S3_PUBLIC_ENDPOINT` w `.env.selfhosted` i uruchom `./scripts/selfhosted/deploy.sh update`.

---

## Ważna konfiguracja (`.env.selfhosted`)

Instalator generuje ten plik. Typowe zmienne obejmują:

- **Domeny i publiczne adresy URL:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Baza danych:** `DATABASE_URL` (wskazuje na usługę `postgres` wewnątrz Compose)
- **Redis:** `REDIS_URL`
- **Składowanie:** `STORAGE_BACKEND`, `S3_*` i opcjonalnie `MINIO_*`
- **Bezpieczeństwo:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Opcjonalne integracje (pozostaw puste, jeśli nieużywane): Stripe, SMTP, GitHub OAuth, Turnstile itp.

**Zmiana wartości związanych z pamięcią lub domeną:** edytuj `.env.selfhosted`, a następnie uruchom:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Jak działa konfiguracja bazy danych (pierwsze uruchomienie czy późniejsze aktualizacje)

Zwykle **nie** wymaga ręcznego uruchomienia SQL. Obsługuje go kontener **bootstrap**.

- **Zupełnie nowa pusta baza danych:** stos stosuje bieżący schemat z kodu, następnie rejestruje, które wersje migracji są już spełnione, więc przyszłe aktualizacje dotyczą tylko migracji **nowy**.
- **Istniejąca baza danych (już zainicjowana):** Stosowane są tylko migracje **aż do**. Twoje dane nie są odbudowywane od zera na każdym `update`.
- Jeśli baza danych **ma już tabele**, ale tabela historii migracji to **brak lub jest pusty** (na przykład częściowe przywrócenie), załaduj **zatrzymuje się z błędem**, aby uniknąć przypadkowego uszkodzenia. Zaawansowane opcje odzyskiwania opisano w [Rozwiązywanie problemów](/docs/selfhosted/troubleshooting).

---

## Serwery Apple Silicon i ARM

Na maszynach **ARM64** (wiele komputerów Mac, niektóre instancje w chmurze) skrypt wdrażania ustawia `DOCKER_DEFAULT_PLATFORM=linux/amd64` dla pobierania obrazów, jeśli nie ustawiłeś tego samodzielnie, więc wstępnie utworzone obrazy, które publikują tylko `amd64`, nadal działają. Jeśli potrzebujesz innego zachowania, ustaw `DOCKER_DEFAULT_PLATFORM` w swoim środowisku przed uruchomieniem skryptu.

Obraz **bootstrap** to zawsze **zbudowany na Twojej maszynie** ze sklonowanego repozytorium, więc zawsze pasuje do Twojego koszyka.

---

## Co działa w Docker (przegląd)

- **Traefik:** HTTPS certyfikaty i routing do pulpitu nawigacyjnego, API i pozyskiwanie nazw hostów.
- **Postgres / Redis:** Dane aplikacji i kolejki.
- **MinIO:** Opcjonalna wewnętrzna pamięć obiektowa.
- **API:** Główny HTTP API.
- **pobieranie-przesyłanie:** Dedykowana usługa przesyłania ruchu przekaźnikowego.
- Statyczny interfejs użytkownika pulpitu nawigacyjnego **sieć:**.
- **Pracownicy:** Przetwarzaj kolejki przyjmowania, artefakty odtwarzania, cykl życia sesji, zaplanowane prace w stylu przechowywania i alerty.

Na tym stosie znajduje się oddzielny proces wsadowy rozliczeń **NIE**; Integracja rozliczeń jest sterowana przez Stripe i API podczas konfigurowania kluczy.

---

## Konfiguracja aplikacji mobilnej

Wskaż host SDK na **twój** API (musi pasować do hosta `API_DOMAIN` / `PUBLIC_API_URL`).

### Przykład React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Użyj prawdziwego adresu URL API. Adresy URL przesyłania są generowane dla `ingest.<your-domain>` automatycznie, gdy serwer jest poprawnie skonfigurowany.

---

## Kopie zapasowe

Utwórz kopię zapasową przynajmniej **PostgreSQL**, **`.env.selfhosted`** i (jeśli używasz wbudowanego MinIO) **dane przechowywania obiektów**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Szczegóły: [Kopia zapasowa i odzyskiwanie](/docs/selfhosted/backup-recovery).

---

## Rozwiązywanie problemów i wsparcie

- [Rozwiązywanie problemów](/docs/selfhosted/troubleshooting) — błędy ładowania początkowego, TLS, pusta powtórka, problemy zewnętrzne S3.
- [Kopia zapasowa i odzyskiwanie](/docs/selfhosted/backup-recovery) — przywróć kolejność i MinIO.

W przypadku błędów lub ulepszeń tych dokumentów skorzystaj z publicznego narzędzia do śledzenia problemów projektu na GitHub.

---

## Powiązana dokumentacja

- [Chmura rozproszona a jednowęzłowa](/docs/distributed-vs-single-node/distributed-vs-single-node) — porównanie z układem chmury obejmującym wiele usług (koncepcyjny).

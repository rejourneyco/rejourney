# Rozwiązywanie problemów na własnym serwerze

Użyj tej strony, jeśli postępujesz zgodnie z [Self-hosted Rejourney](/docs/selfhosted) i coś nie działa lub zachowuje się dziwnie. Polecenia są uruchamiane z **katalog główny repozytorium** (gdzie mieszka `docker-compose.selfhosted.yml`).

---

## Szybkie kontrole

### Stan usługi

```bash
./scripts/selfhosted/deploy.sh status
```

### Dzienniki API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Prześlij dzienniki przekaźników

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Dzienniki pracowników

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Instalacja lub aktualizacja nie powiodła się przed lub w trakcie ładowania początkowego

### Objawy

- `bootstrap` wychodzi z wartości niezerowej
- usługi aplikacji nigdy nie stają się zdrowe
- `status` pokazuje API lub pracowników oczekujących na bootstrap
- zainstaluj lub zaktualizuj wyjścia za pomocą `Database authentication failed before bootstrap.`

### Kontrole

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Najczęstsze przyczyny:

- zły `DATABASE_URL`
- niezgodność poświadczeń (np. z wcześniejszego nieudanego wdrożenia)
- brak `STORAGE_ENCRYPTION_KEY`
- nieprawidłowe poświadczenia S3
- uszkodzony zewnętrzny adres URL punktu końcowego S3
- na **ARM64**, brak obsługi obrazu (ustaw `DOCKER_DEFAULT_PLATFORM=linux/amd64` lub użyj `./scripts/selfhosted/deploy.sh`, który ustawia go, gdy nie jest ustawiony)

Powrót do zdrowia:

1. Jeśli nadal masz oryginalny `.env.selfhosted`, przywróć go i uruchom:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Jeśli nie potrzebujesz starych danych, wyczyść i zainstaluj ponownie:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Schemat/wiadomości migracyjne:** Podczas normalnej instalacji baza danych zaczyna być pusta, a bootstrap wszystko konfiguruje. Jeśli przeniesiesz **przywrócono Postgres z kopii zapasowej** na nowy serwer, ale brakuje metadanych migracji lub wskazałeś stos na **zła baza danych**, bootstrap może zakończyć się z błędem dotyczącym niespójnej bazy danych, zamiast nadpisać dane. Jeśli nie wykonujesz zaawansowanego odzyskiwania, napraw `DATABASE_URL` i przywróć spójną kopię zapasową lub zacznij od czystego woluminu. W przypadku celowego odzyskiwania wyłącznie po migracji, niektóre konfiguracje używają `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` w `.env.selfhosted` (przed użyciem tego zobacz dokumentację opiekuna lub pomoc techniczną).

### Naprawić

1. Jeśli masz oryginalny `.env.selfhosted`, przywróć go i uruchom ponownie:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Jeśli nie masz oryginalnego `.env.selfhosted`, wyczyść i zainstaluj ponownie:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` ponownie uruchamia synchronizację schematu, materiału siewnego i punktu końcowego magazynu. `reset` usuwa samodzielnie hostowane kontenery i woluminy danych, dzięki czemu nowa instalacja może bezpiecznie wygenerować nowe poświadczenia.

---

## 2. Sesje są zliczane, ale opcja Powtórka pozostaje pusta

### Co to zwykle oznacza teraz

Przy obecnej architekturze jest to zwykle jedna z dwóch rzeczy:

- `ingest-upload` nie mógł zapisać bajtów artefaktu
- `ingest-worker` nie mógł przetworzyć przesłanego artefaktu

Urządzenie nie przesyła już bezpośrednio do MinIO/S3, więc dostępność zasobnika z telefonu nie jest już głównym podejrzanym.

### Kontrole

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Szukać:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Powszechne przyczyny

- błędne dane uwierzytelniające S3 w `.env.selfhosted`
- Brak zewnętrznej łyżki S3
- zewnętrzny punkt końcowy S3 nieosiągalny z sieci Docker
- Przekaźnik przesyłania jest niezdrowy
- pracownik utknął podczas ponawiania nieudanych artefaktów

### Naprawić

- sprawdź wartości `S3_*`
- jeśli zmieniłeś konfigurację pamięci, uruchom ponownie:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Panel ładuje się, ale wywołania autoryzacji lub API kończą się niepowodzeniem

### Kontrole

- Host panelu kontrolnego DNS wskazuje na serwer
- Host API DNS wskazuje na serwer
- host pozyskiwania DNS wskazuje na serwer
- porty `80` i `443` są otwarte
- Let’s Encrypt wydał certyfikaty

Sprawdzać:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS lub problemy z certyfikatem

Traefik automatycznie zarządza certyfikatami.

### Kontrole

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Upewnij się, że obie nazwy odpowiadają serwerowi, na którym działa stos.

Jeśli DNS był błędny podczas pierwszej instalacji, napraw DNS i uruchom ponownie:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. Zewnętrzny S3 działa w CLI, ale Rejourney nie może przesyłać

Pamiętaj, że ścieżka przesyłania jest po stronie serwera.

Ważna ścieżka sieciowa to:

- Kontener `ingest-upload` -> Twój punkt końcowy S3

Przetestuj na serwerze, przeglądając dzienniki przekazywania i potwierdzając punkt końcowy/zasobnik/klucze w `.env.selfhosted`.

Jeśli je zmieniłeś, uruchom ponownie:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Wbudowana instalacja MinIO, ale artefakty nadal nie działają

### Kontrole

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

Jednorazowy plik `minio-setup` powinien utworzyć wiadro o nazwie `S3_BUCKET`.

Jeśli zmieniłeś nazwę segmentu po pierwszej instalacji, uruchom:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Strony rozliczeniowe pokazują wyłączone rozliczenia

Jest to oczekiwane, chyba że skonfigurowano klucze Stripe.

Stos nie wyłącza już rozliczeń, ponieważ jest „hostowany samodzielnie”. Wyłącza rozliczenia, ponieważ Stripe jest nieskonfigurowany.

Jeśli nie ustawisz kluczy Stripe:

- Interfejs rozliczeniowy pozostaje w stanie samodzielnego hostowania/nieograniczonym
- Stripe Checkout i webhooki pozostają wyłączone

---

## 8. Punkt końcowy przechowywania w Postgres jest nieprawidłowy po zmianie `.env.selfhosted`

Uruchomić:

```bash
./scripts/selfhosted/deploy.sh update
```

Ścieżka aktualizacji ponownie uruchamia bootstrap i ponownie synchronizuje aktywny wiersz `storage_endpoints`.

---

## 9. Konieczność zatrzymania usług bez utraty danych

Używać:

```bash
./scripts/selfhosted/deploy.sh stop
```

Spowoduje to zatrzymanie tylko kontenerów. Nie usuwa woluminów.

---

## 10. Potrzebujesz głębszych logów dla jednej usługi

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```

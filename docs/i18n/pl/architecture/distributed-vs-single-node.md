# Chmura rozproszona a jednowęzłowa

Rejourney obsługuje dwa oficjalne kształty wdrożeń hostowanych samodzielnie:

- **Jednowęzłowy Docker Compose** dla jednego serwera lub VPS
- **Rozproszone K3s** do klastrów produkcyjnych i skalowania poziomego

Obydwa korzystają teraz z tego samego podstawowego modelu zaplecza:

- punkty końcowe magazynu są wspierane przez bazę danych
- Przesyłane pliki przechodzą przez przekaźnik przesyłania należący do zaplecza
- pracownicy przetwarzają zweryfikowane artefakty
- widoczność powtórek zależy od artefaktów

---

## Porównanie funkcji

| Funkcja | Chmura rozproszona | Chmura jednowęzłowa |
|---------|--------------------|-------------------|
| Platforma | K3s | Docker Compose |
| Skala | Wielowęzłowy | Jednowęzłowy |
| Publiczne punkty wejścia | Traefik wejście | Pojemnik Traefik |
| Ścieżka przesyłania | API + usługa pobierania i przesyłania | API + usługa pobierania i przesyłania |
| Przechowywanie źródła prawdy | Tabela `storage_endpoints` | Tabela `storage_endpoints` |
| Domyślna pamięć obiektów | Zewnętrzny S3 | Wbudowany MinIO |
| Zewnętrzna obsługa S3 | Tak | Tak |
| Tajne szyfrowanie | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Aktualizuj przepływ | k8s wdrożenie + zadania | `deploy.sh update` |

---

## Model pamięci współdzielonej

W obu modelach wdrażania konfiguracja pamięci wykonawczej pochodzi z Postgres, a nie z rezerwowego środowiska env.

To oznacza:

- aktywny punkt końcowy magazynu obiektów jest przechowywany w `storage_endpoints`
- tajne klucze dostępu są szyfrowane w `key_ref`
- środowisko wykonawcze odczytuje wiersz bazy danych
- Skrypty bootstrap/install są odpowiedzialne za synchronizację danych wejściowych `.env` z wierszem bazy danych

To sprawia, że ​​samodzielne Docker jest znacznie bliższe prod i local-k8s niż stary model rezerwowy.

---

## Kiedy wybrać jednowęzłowy Docker Compose

Wybierz Docker Compose, gdy:

- wdrażasz na jednym hoście VPS lub na serwerze bare-metal
- chcesz najszybszą ścieżkę instalacji
- chcesz domyślnie mieć wbudowany MinIO
- nie potrzebujesz skalowania wielu węzłów ani operacji Kubernetes

Oficjalne punkty wejścia:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Kiedy wybrać rozproszony K3s

Wybierz K3s, gdy:

- potrzebujesz wielu węzłów
- chcesz natywnych operacji i obsługi sekretów Kubernetes
- chcesz niezależnie skalować API, przesyłanie i usługi robocze
- chcesz stopniowych wdrożeń i silniejszej izolacji infrastruktury

Ścieżka K3s znajduje się pod `k8s/` i `scripts/k8s/`.

---

## Różnica operacyjna

Główną różnicą nie jest już model danych. Ma postać operacyjną:

- Compose: jedna maszyna, jedna sieć Docker, jeden skrypt operatora
- K3s: wiele podów, przestrzenie nazw, ruch przychodzący do klastra, zadania i sekrety Kubernetes

---

## Praktyczne wskazówki

Jeśli chcesz szybko samodzielnie hostować, zacznij od jednowęzłowego Compose.

Przejdź na K3s, jeśli potrzebujesz:

- większa przepustowość
- wdrażany jest klaster kroczący
- skalowanie poziome
- bardziej odporna separacja infrastruktury

---

## Dokumentacja architektury wewnętrznej

Aby uzyskać najnowsze wewnętrzne wizualizacje inżynieryjne i głębsze szczegóły operatora:

- `dev_docs/ingest-session-recording-lifecycle.md` (schemat cyklu życia sesji)
- `dev_docs/storage-and-endpoints.md` (schemat topologii wielu segmentów)
- `dev_docs/allthingscloud.md` (schemat konfiguracji chmury k3s)

Aby uzyskać stronę dotyczącą architektury zawierającej wyłącznie grafikę, otwórz [`/docs/architecture/diagrams`](/docs/architecture/diagrams).

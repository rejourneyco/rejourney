# CI/CD i testy automatyczne

Rejourney wykorzystuje GitHub Actions, aby zapewnić jakość kodu w całym monorepo. Każde żądanie ściągnięcia i wypchnięcie do głównej gałęzi uruchamia kompleksowy zestaw testów.

## Zestawy testowe

### 1. Testy backendu API
Testy te, znajdujące się w katalogu `backend/`, zapewniają stabilność podstawowej logiki i interakcji z bazą danych.
* **Linting**: Używa ESLint do wymuszania stylu kodu i wychwytywania typowych błędów.
* **Testy jednostkowe**: Obsługiwany przez Vitest, testuje logikę usług, funkcje narzędziowe i kontrolery API.
* **Zbuduj weryfikację**: Zapewnia poprawną kompilację źródła TypeScript do ostatecznej dystrybucji.

### 2. Testy React Native SDK
Testy te, zlokalizowane w `packages/react-native/`, mają kluczowe znaczenie dla stabilności między platformami.
* **TypeScript Sprawdź**: Sprawdza typy w całym SDK, wychwytując potencjalne niedopasowania mostków.
* **Linting**: wymusza stałą jakość kodu.
* **Zbuduj weryfikację**: Uruchamia skrypt przygotowujący, aby upewnić się, że pakiet będzie mógł zostać dołączony do dystrybucji.

### 3. Testy panelu WWW
Znajduje się w `dashboard/web-ui/` i skupia się na interfejsie użytkownika i SSR.
* **TypeScript Sprawdź**: Zawiera generację typu routera React w celu zapewnienia bezpieczeństwa trasy.
* **Budowa SSR**: sprawdza, czy cała aplikacja Remix/React Router może zostać zbudowana do renderowania po stronie serwera.

---

## Natywne testy integracyjne
Jedną z najbardziej niezawodnych części naszego CI/CD jest walidacja SDK w rzeczywistych środowiskach platformowych.

### Integracja iOS (najnowsza wersja macos)
* **Świeża instalacja**: CI tworzy od podstaw zupełnie nowy projekt React Native.
* **Wstrzyknięcie pakietu**: Łączy lokalny SDK przy użyciu `npm pack` i instaluje go w aplikacji testowej.
* **Weryfikacja CocoaPods**: Uruchamia `pod install`, aby upewnić się, że natywne zależności i podspecy są poprawnie połączone.
* **Zbuduj weryfikację**: Wykonuje `xcodebuild`, aby upewnić się, że aplikacja testowa pomyślnie się skompiluje ze zintegrowaną wersją SDK.

### Integracja Android (najnowsza wersja Ubuntu)
* **Świeża instalacja**: Podobnie jak w przypadku iOS, inicjowany jest nowy projekt React Native oparty na Android.
* **Zbuduj weryfikację**: Uruchamia `./gradlew assembleDebug`, aby upewnić się, że w natywnym kodzie Android nie ma oczywistych konfliktów ani błędów kompilacji.

---

## Logika wdrażania i publikowania

### Zautomatyzowane wdrażanie w chmurze (VPS)
Wdrożenie w naszym środowisku produkcyjnym jest kontrolowane przez wersjonowanie.
* **Kontrola wersji**: Dedykowane zadanie porównuje wersję główną `package.json` z poprzednim zatwierdzeniem.
* **Wyzwalanie warunkowe**: Wdrożenie przebiega tylko wtedy, gdy wersja została zwiększona.
* **Zautomatyzowane wdrażanie**: Po uruchomieniu stosuje najnowsze manifesty K8 i wykonuje stopniowy restart wszystkich wdrożeń (interfejs API, sieć i procesy robocze).

### Zautomatyzowane publikowanie SDK (NPM)
Utrzymujemy płynny przepływ publikacji pakietu `rejourney`.
* **Wrażliwość na ścieżkę**: Uruchamia się tylko w przypadku modyfikacji plików wewnątrz `packages/react-native/`.
* **Kontrola rejestru**: Porównuje wersję pakietu lokalnego z najnowszą wersją w rejestrze NPM.
* **Publikuj automatycznie**: Jeśli wersja lokalna jest nowsza, automatycznie publikuje nową wersję w NPM po przejściu wszystkich testów.

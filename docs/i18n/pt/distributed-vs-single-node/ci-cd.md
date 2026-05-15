# CI/CD e testes automatizados

Rejourney usa GitHub Actions para garantir a qualidade do código em todo o monorepo. Cada solicitação pull e push para o branch principal aciona uma bateria abrangente de testes.

## Conjuntos de testes

### 1. Testes de back-end API
Localizados no diretório `backend/`, esses testes garantem que a lógica central e as interações do banco de dados sejam estáveis.
* **Linting**: usa ESLint para impor estilo de código e detectar erros comuns.
* **Testes unitários**: Desenvolvido por Vitest, testando lógica de serviço, funções de utilidade e controladores API.
* **Verificação de compilação**: Garante que a origem TypeScript seja compilada corretamente na distribuição final.

### 2. Testes React Native SDK
Localizados em `packages/react-native/`, esses testes são essenciais para a estabilidade entre plataformas.
* **Verificação TypeScript**: valida tipos em todo o SDK, capturando possíveis incompatibilidades de ponte.
* **Linting**: impõe qualidade de código consistente.
* **Verificação de compilação**: Executa o script de preparação para garantir que o pacote possa ser empacotado para distribuição.

### 3. Testes de painel da web
Localizado em `dashboard/web-ui/`, com foco na interface do usuário e SSR.
* **Verificação TypeScript**: Inclui geração do tipo React Router para garantir a segurança da rota.
* **Construção SSR**: Verifica se todo o aplicativo Remix/React Router pode ser construído para renderização no lado do servidor.

---

## Teste de integração nativa
Uma das partes mais robustas do nosso CI/CD é a validação do SDK em ambientes de plataforma reais.

### Integração iOS (macos-mais recente)
* **Nova instalação**: O CI cria um projeto React Native totalmente novo do zero.
* **Injeção de Pacote**: Ele agrupa o SDK local usando `npm pack` e o instala no aplicativo de teste.
* **Verificação CocoaPods**: executa `pod install` para garantir que as dependências nativas e podspecs estejam vinculados corretamente.
* **Verificação de compilação**: executa `xcodebuild` para garantir que o aplicativo de teste seja compilado com sucesso com o SDK integrado.

### Integração Android (ubuntu mais recente)
* **Nova instalação**: Semelhante a iOS, um novo projeto React Native baseado em Android é inicializado.
* **Verificação de compilação**: executa `./gradlew assembleDebug` para garantir que não haja conflitos de manifesto ou erros de compilação no código nativo Android.

---

## Lógica de implantação e publicação

### Implantação automatizada de nuvem (VPS)
A implantação em nosso ambiente de produção é controlada pelo controle de versão.
* **Verificação de versão**: Um trabalho dedicado compara a versão raiz `package.json` com o commit anterior.
* **Gatilho Condicional**: A implementação continuará apenas se a versão tiver sido incrementada.
* **Implementação automatizada**: se acionado, ele aplica os manifestos K8s mais recentes e executa uma reinicialização contínua de todas as implantações (API, Web e trabalhadores).

### Publicação automatizada SDK (NPM)
Mantemos um fluxo de publicação contínuo para o pacote `rejourney`.
* **Sensível ao caminho**: É acionado apenas quando os arquivos dentro de `packages/react-native/` são modificados.
* **Verificação de registro**: compara a versão do pacote local com a versão mais recente no registro NPM.
* **Publicar automaticamente**: Se a versão local for superior, ele publica automaticamente a nova versão no NPM após a aprovação em todos os testes.

# Leitura em Voz

PWA para ouvir textos, livros ePub e PDFs com as vozes **Neural2** e **Chirp 3 HD** (pt-BR) do Google Cloud Text-to-Speech.
É 100% front-end (HTML, CSS e JS estáticos) e roda no GitHub Pages, sem servidor.

## Funcionalidades

- **Texto:** cole um texto e toque em *Ouvir*. O trecho em leitura fica destacado; toque em outro trecho para pular até ele.
- **Livro:** abra `.epub` (renderizado com epub.js) ou `.pdf` (renderizado com pdf.js).
  - O texto do capítulo ou página é dividido em trechos de no máximo um parágrafo (parágrafos longos viram vários trechos de até cerca de 900 caracteres), bem abaixo do limite de 5000 bytes da API.
  - Os próximos 3 trechos são sintetizados enquanto o atual toca, para não haver pausas, inclusive na passagem de um capítulo para o outro.
  - O progresso (capítulo/página, parágrafo, trecho e CFI) é salvo no `localStorage` a cada trecho. Ao reabrir o livro, o app pergunta se você quer continuar ou recomeçar.
  - Use *Ler daqui* para começar pela página visível. No ePub, toque em um parágrafo para marcá-lo como ponto de início e depois em *▶ Ler daqui*; um toque duplo começa na hora. O parágrafo em leitura fica destacado.
  - Ao parar (■), o app mostra **onde você parou**: capítulo, número do parágrafo, começo do parágrafo e a frase aproximada, com um botão para copiar o trecho e buscá-lo no Kindle. Tocar nas informações do player mostra isso a qualquer momento.
  - Os livros abertos recentemente ficam guardados no IndexedDB para reabrir com um toque.
- **Resumo com Gemini (opcional):** no livro, o botão *Resumir capítulo* (ou *Resumir página*, no PDF) envia o texto do capítulo exibido para a API Gemini e mostra o resumo em um modal. O resumo fica guardado no aparelho, então reabrir não gasta cota. A chave do Gemini é informada em *Configurações* e salva no `localStorage`.
- **Dois motores de voz:** escolha rápida (Google / OpenAI) logo abaixo das abas ou em *Configurações*. Google Cloud TTS (Neural2 e Chirp 3 HD) ou OpenAI TTS (`tts-1-hd`, vozes onyx, nova, alloy, echo, fable e shimmer). O app avisa se a credencial do motor escolhido não estiver preenchida.
- **Áudios guardados:** cada trecho gerado para um livro fica no IndexedDB do aparelho e é reaproveitado ao reouvir, sem nova chamada à API. O botão *Baixar capítulo* gera o capítulo inteiro de uma vez. Com o capítulo todo guardado, o botão vira *Exportar MP3* e junta os trechos em um único arquivo `.mp3` (sem nova chamada à API).
- **Player fixo:** reproduzir/pausar, voltar e avançar trecho, parar, timer de sono e controles na tela de bloqueio (Media Session).
- **Configurações:** chave da Service Account (upload ou colar), OpenAI API Key, Gemini API Key e modelo, motor de voz, tipo de voz, voz, velocidade, tom, contador de uso do mês e tema.
- **Ajuda:** explica a cobrança e mostra o passo a passo para configurar o Google Cloud.
- **PWA:** pode ser instalado e recebe textos pelo menu *Compartilhar* do Android (Web Share Target).

## Como a autenticação funciona sem backend

1. O JSON da Service Account fica salvo no `localStorage` do aparelho.
2. O app monta um JWT (`iss` = e-mail da conta, `scope` = cloud-platform, `aud` = `https://oauth2.googleapis.com/token`, validade de 1 h).
3. O JWT é assinado em **RS256** pela **Web Crypto API** (`crypto.subtle.importKey('pkcs8', …)` e `crypto.subtle.sign('RSASSA-PKCS1-v1_5', …)`), sem nenhuma biblioteca externa.
4. O JWT é trocado por um *access token* em `oauth2.googleapis.com/token` (grant `jwt-bearer`). O token fica em memória e é renovado 5 minutos antes de expirar.
5. Se o endpoint de token estiver inacessível, o app usa um **JWT autoassinado** com `aud = https://texttospeech.googleapis.com/` direto como Bearer, método também aceito pelas APIs do Google.

> ⚠️ A chave fica salva no navegador. Use um projeto exclusivo, uma Service Account **sem papéis** e não use o app em computadores compartilhados.

## Publicar no GitHub Pages

1. Envie os arquivos para a branch `main` do repositório.
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main` e pasta `/ (root)`.
3. O app ficará em `https://alessandrociapina-cpu.github.io/leitura-texto/`.

Para testar localmente, rode `python -m http.server 8000` nesta pasta e abra `http://localhost:8000`. A Web Crypto exige HTTPS ou localhost.

## Estrutura

```
index.html      interface (abas Texto / Livro / Ajuda, player e modais)
styles.css      tema escuro por padrão, layout mobile-first
version.js      número da versão (topo da tela e cache do service worker)
app.js          autenticação JWT, cliente TTS, fila de áudio, leitores ePub/PDF
manifest.json   manifesto PWA (ícones e share_target)
sw.js           service worker (cache offline do app e das bibliotecas)
icons/          ícones do app
```

Bibliotecas carregadas sob demanda via CDN: epub.js 0.3.93, JSZip 3.10.1 e pdf.js 3.11.174.

# NegaPay 💳

Controle de cartões adicionais — para uso pessoal entre Pinho (admin) e Getlio (primo).

---

## Estrutura do projeto

```
NegaPay/
├── index.html              ← App completo (login + admin + primo)
├── manifest.json           ← PWA
├── sw.js                   ← Service Worker (offline)
├── assets/
│   ├── icon-192.png        ← Ícone do app (192x192)
│   ├── icon-512.png        ← Ícone do app (512x512)
│   ├── bradesco-logo.png   ← Logo do Bradesco Prime
│   └── bradesco-card.png   ← Imagem do cartão físico
├── css/
│   └── style.css
├── js/
│   ├── config.js           ← ⚙️ Configuração central (edite aqui)
│   ├── auth.js             ← Autenticação e sessão
│   ├── pdf-parser.js       ← Parser da fatura Bradesco
│   ├── admin.js            ← Painel do Pinho
│   └── primo.js            ← Painel do Getlio
└── appscript/
    └── Code.gs             ← Backend Google Apps Script
```

---

## Setup — passo a passo

### 1. Preparar os assets

Coloque na pasta `assets/`:
- `icon-192.png` — ícone do NegaPay (192x192px)
- `icon-512.png` — ícone do NegaPay (512x512px)
- `bradesco-logo.png` — logo do Bradesco Prime
- `bradesco-card.png` — foto do cartão físico

### 2. Criar o Apps Script e a Planilha

1. Acesse [script.google.com](https://script.google.com)
2. Clique em **Novo projeto**
3. Cole o conteúdo de `appscript/Code.gs`
4. No menu superior, execute a função **`setupSheet`** (clique em ▶ com ela selecionada)
5. Autorize as permissões solicitadas
6. Copie o **ID da planilha** que aparece no log
7. Cole o ID em `Code.gs` na variável `SHEET_ID`

### 3. Trocar as senhas padrão

Antes de publicar, edite a função `setupSheet` em `Code.gs` e mude:
- `'negapay@admin'` → senha do Pinho
- `'negapay@primo'` → senha do Getlio

Também edite no topo de `Code.gs`:
- `EMAIL_PRIMO` → email que receberá a notificação de fatura disponível
- `EMAIL_ADMIN` → email do Pinho que receberá uma cópia da notificação

Ou mude diretamente na planilha criada (aba `usuarios`, coluna `senhaHash` — use a função `hashSenha()` para gerar o hash correto).

### 4. Publicar o Apps Script como Web App

1. No editor do Apps Script, clique em **Implantar → Nova implantação**
2. Tipo: **App da Web**
3. Executar como: **Eu (sua conta)**
4. Quem tem acesso: **Qualquer pessoa** (necessário para o frontend acessar)
5. Clique em **Implantar** e copie a **URL do Web App**
6. Cole a URL em `js/config.js` no campo `apiUrl`

### 5. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex: `negapay`)
2. Faça push de todos os arquivos da pasta `NegaPay/`
3. Vá em **Settings → Pages → Source → main branch → / (root)**
4. Aguarde alguns minutos — o app estará em `https://SEU_USUARIO.github.io/negapay`

### 6. Instalar no iPhone como PWA

1. Abra o link no Safari do iPhone
2. Toque em **Compartilhar → Adicionar à Tela de Início**
3. O NegaPay vai aparecer como app nativo na tela inicial

---

## Uso diário

### Pinho (admin)
1. Abre o app → faz login com suas credenciais
2. Seleciona o banco (Bradesco por enquanto)
3. Faz upload do PDF da fatura completa
4. Revisa os lançamentos dos cartões do Getlio
5. Clica **Publicar fatura**

### Getlio (primo)
1. Abre o link ou o PWA no iPhone
2. Vê o valor total a pagar e a data de vencimento
3. Clica **+ Adicionar** para colocar lembrete no Calendário
4. Quando pagar, clica **Marcar como pago**

---

## Adicionar novo banco no futuro

Edite apenas `js/config.js`:

```js
bancos: [
  { /* Bradesco — já existe */ },
  {
    id: 'nubank',
    nome: 'Nubank',
    cor: '#8A05BE',
    corSecundaria: '#3d0066',
    logoUrl: 'assets/nubank-logo.png',
    cardImageUrl: 'assets/nubank-card.png',
    diaVencimento: 15,
    padraoSecao: /...padrão do PDF do Nubank.../i,
    padraoLancamento: /...padrão de linha.../i,
    padraoTotal: /...padrão do total.../i,
    cartoesPrimo: [
      { final: 'ZZZZ', apelido: 'Cartão Nubank', titular: 'Getlio R D S Farias' }
    ]
  }
]
```

Nenhum outro arquivo precisa ser alterado.

---

## Credenciais padrão (MUDE ANTES DE PUBLICAR)

| Usuário | Senha padrão | Perfil |
|---------|-------------|--------|
| pinho   | negapay@admin | Admin |
| getlio  | negapay@primo | Primo |

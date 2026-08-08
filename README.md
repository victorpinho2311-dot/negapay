# NegaPay 💳

Controle de cartões adicionais entre Pinho (admin) e Getúlio (primo).

O Pinho é titular dos cartões; o Getúlio tem adicionais. Todo mês o Pinho envia
o PDF da fatura e o app calcula, e mostra para os dois, **quanto o Getúlio deve**.

---

## O ponto principal: o app confere a própria conta

A fatura do Bradesco imprime, para cada cartão, o total daquele cartão:

```
Gastos referentes ao cartão: Final 9087 | GETLIO R D S FARIAS   Valor da fatura: R$ 2.061,16
```

O app soma os lançamentos e compara com esse valor. **Se não bater ao centavo,
ele se recusa a publicar.** Também confere se a soma das seções fecha com o
total geral da fatura.

É por isso que só aceita **PDF**. O CSV do Bradesco tem os mesmos lançamentos,
mas não traz a data de vencimento nem o total por cartão — sem eles não existe
como verificar o resultado, só confiar nele.

---

## Estrutura

```
NegaPay/
├── index.html                  ← app (login + admin + primo)
├── manifest.json · sw.js       ← PWA
├── css/style.css
├── js/
│   ├── config.js               ← produtos e textos
│   ├── formato.js              ← moeda e data (fonte única)
│   ├── auth.js                 ← sessão + cliente da API
│   ├── parser-bradesco.js      ← lê o PDF e confere os totais
│   ├── admin.js                ← painel do Pinho
│   └── primo.js                ← painel do Getúlio
├── appscript/Code.js           ← backend Apps Script
└── testes/                     ← suíte sobre faturas reais
```

---

## Uso mensal

**Pinho** abre o app → arrasta o PDF da fatura → confere o bloco verde
("Conferência bateu") → **Publicar fatura**. Se aparecer um cartão que o app não
conhece, ele pergunta de quem é antes de deixar publicar.

Com dois cartões (Infinite e Æternum), são dois PDFs. Cada um é publicado
separadamente e os dois convivem no mesmo mês.

**Getúlio** abre o app e vê **um valor**: quanto deve no total. Abaixo, o detalhe
por fatura, com o vencimento de cada uma. Toca numa fatura para ver os
lançamentos, e marca como pago quando pagar.

---

## Setup

### 1. Planilha e Apps Script

1. Cole o conteúdo de `appscript/Code.js` em [script.google.com](https://script.google.com)
2. Ajuste no topo: `SHEET_ID`, `EMAIL_PRIMO`, `EMAIL_ADMIN`
3. Rode **`setupV2()`** uma vez — cria as abas `faturas_v2`, `lancamentos_v2` e `cartoes`
4. **Implantar → Nova implantação** · App da Web · Executar como **eu** · Acesso **qualquer pessoa**
5. Cole a URL da implantação em `apiUrl` no `js/config.js`

A aba `usuarios` guarda login, hash da senha e perfil (`admin` / `primo`).
Use `hashSenha()` para gerar o hash ao trocar uma senha pela planilha.

### 2. Frontend

Push para `main` → GitHub Pages publica.

**Ao mexer em `js/` ou `css/`, atualize o `?v=` nas tags do `index.html`** — o
Safari em PWA guarda os assets com força.

### 3. iPhone

Abra no Safari → Compartilhar → Adicionar à Tela de Início.

---

## Cartão ou produto novo

**Cartão adicional novo:** não precisa mexer em código. Ele aparece na tela ao
publicar e você diz de quem é.

**Produto novo** (outro cartão titular, com fatura própria): adicione em
`produtos` no `js/config.js`, usando os 4 dígitos do cartão que aparece na capa
do PDF:

```js
{ cartaoCapa: '3268', nome: 'Visa Æternum', cor: '#8A6E2F', ... }
```

Sem isso o app ainda funciona — só chama a fatura de "Cartão final 3268".

---

## Testes

```bash
cd testes && npm install && npm test
```

Rode antes de publicar qualquer mudança no parser. Detalhes em
[testes/README.md](testes/README.md).

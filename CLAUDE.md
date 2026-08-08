# NegaPay

PWA pessoal de controle de cartões adicionais entre **Pinho** (admin, publica faturas) e **Getúlio** (primo, visualiza e marca como pago).

Sem build, sem npm, sem framework. HTML/CSS/JS vanilla servido pelo GitHub Pages + backend em Google Apps Script sobre uma planilha do Google Sheets.

## ⚠️ Antes de mexer — leia primeiro

**Sempre, no início de qualquer conversa, antes de ler código ou editar qualquer coisa:**

1. Leia este CLAUDE.md por inteiro (já vem carregado automaticamente — não precisa reler do disco).
2. Consulte o grafo em vez de varrer o repositório:
   ```bash
   graphify query "<a pergunta em questão>"
   ```
   Isso devolve um subgrafo pequeno e direcionado. É **muito mais barato em tokens** do que `grep -r`, ler arquivos inteiros ou abrir o `GRAPH_REPORT.md`. Use `graphify path "<A>" "<B>"` para entender relações e `graphify explain "<conceito>"` para um ponto específico.
3. Só leia os arquivos que o grafo apontar como relevantes — não os 2.800 linhas do projeto inteiro.

**Depois de qualquer alteração relevante, atualize os dois:**

```bash
graphify update .          # SÓ quando o que mudou foi código (AST, sem custo de API)
```

⚠️ **`graphify update .` só reprocessa código.** Se o que mudou foi um documento (este CLAUDE.md, o README), ele *invalida* as arestas semânticas daquele arquivo sem reconstruí-las — o grafo perde ligações e as comunidades se fragmentam. Para mudança em documento, use `/graphify --update`, que roda a extração semântica de novo. Detalhes em *graphify* no fim do arquivo.

E edite este CLAUDE.md quando a mudança afetar algo aqui descrito — arquitetura, contrato da API, formato de dados, fluxo de deploy, convenções ou a lista de *Débitos conhecidos* (item corrigido sai da lista; problema novo entra). Um CLAUDE.md desatualizado custa mais caro que um inexistente, porque manda a sessão seguinte na direção errada.

Alteração "relevante" = mudou uma ação da API, o formato de um dado persistido, um módulo inteiro, o processo de deploy, ou corrigiu/introduziu um débito conhecido. Ajuste de CSS ou texto de UI não precisa.

## Arquitetura

```
Browser (GitHub Pages)                Google Apps Script          Google Sheets
  index.html                            doGet(e)                    usuarios
    ├── js/config.js        ← produtos    └── switch(acao)           cartoes
    ├── js/formato.js       ← moeda/data        login/validarToken   faturas_v2
    ├── js/auth.js          ← Auth + API        salvarFatura         lancamentos_v2
    ├── js/parser-bradesco.js ← PDF             listarFaturas/getFatura
    ├── js/admin.js         ← painel Pinho      getResumo
    └── js/primo.js         ← painel Getúlio    registrarPagamento
                                                excluirFatura
                                                enviarNotificacaoFatura
```

- **Frontend**: cada `js/*.js` é um IIFE que expõe um global (`Auth`, `API`, `Fmt`, `ParserBradesco`, `Admin`, `Primo`) e também se registra em `window`. `UI` é definido inline em [index.html](index.html#L152). Não há módulos ES — a ordem das tags `<script>` importa.
- **Navegação**: três `<div class="page">` (login/admin/primo); `UI.mostrarPagina(id)` alterna a classe `.active`. Não há router.
- **Render**: tudo via `innerHTML` com template strings. Handlers são `onclick="Admin._xxx()"` inline, por isso os métodos `_privados` precisam estar no `return` do IIFE.
- **Backend**: [appscript/Code.js](appscript/Code.js) — um único `doGet` que faz dispatch por `body.acao`. Toda ação (exceto `login`) chama `validarToken(body)` primeiro; ações de escrita do admin também checam `auth.perfil !== 'admin'`.

## Contrato da API

Todas as chamadas passam por `API.post()` em [js/auth.js](js/auth.js#L78), que **usa GET** com o body serializado em `?payload=<JSON url-encoded>` — isso evita o preflight CORS que o Apps Script não responde. Não troque para `fetch` POST com `Content-Type: application/json`: quebra em produção.

O token vem do `localStorage` (`negapay_token`) e é injetado automaticamente em todo request.

Ações: `login`, `validarToken`, `logout`, `listarCartoes`, `definirDonoCartao`, `salvarFatura`, `listarFaturas`, `getFatura`, `getResumo`, `registrarPagamento`, `excluirFatura`, `enviarNotificacaoFatura`.
Resposta é sempre `{ ok: true, ... }` ou `{ ok: false, erro: '...' }`.

## Deploy

Não existe comando de build. Duas partes independentes:

1. **Frontend** — `git push` para `main`; o GitHub Pages publica em `https://victorpinho2311-dot.github.io/negapay/`.
   **Sempre atualize o cache-busting** (`?v=AAAAMMDD-N`) nas tags `<script>`/`<link>` do [index.html](index.html#L142-L146) ao mexer em `js/` ou `css/` — o Safari em PWA guarda os assets agressivamente. O `sw.js` já foi neutralizado (não cacheia nada) justamente por isso.
2. **Backend** — `clasp push` envia `appscript/` para o projeto Apps Script (`.clasp.json`). Depois é preciso **criar uma nova implantação** no editor do Apps Script; a URL da implantação vai em `apiUrl` no [js/config.js](js/config.js#L11). Editar o código sem reimplantar não muda nada em produção.

## Configuração

[js/config.js](js/config.js): `apiUrl`, `produtos` (um por fatura, identificado pelo cartão da capa) e textos. **Não** tem mais `diaVencimento`, regexes de parser nem lista de cartões do primo — os três causavam erro de valor e foram removidos.

De quem é cada cartão fica na aba `cartoes` da planilha, não no código. Cartão novo é perguntado na tela na primeira vez que aparece.

No backend, o topo de [appscript/Code.js](appscript/Code.js#L26-L28) tem `SHEET_ID`, `EMAIL_PRIMO` e `EMAIL_ADMIN`.

## Dinheiro e datas — as regras que não podem ser quebradas

**Dinheiro trafega em CENTAVOS (inteiro)** do parser até a tela e até a planilha. Nunca use float: somar 377 lançamentos em ponto flutuante erra centavo, e a soma precisa fechar *exatamente* com o total que o banco declara. `Fmt.moeda()` converte para exibição; negativo sai como `−R$ 2.722,79`, com o sinal antes do `R$`.

**O vencimento é lido do PDF** (`Data de vencimento: DD/MM/YYYY`), nunca calculado. A regra antiga ("dia 5 do mês seguinte") errava o mês inteiro e ainda assumia um dia fixo — a Æternum vence dia 10, a Infinite dia 5.

**`mesAno` (`MM/YYYY`) vem do mês do vencimento**, nunca do relógio. Era o relógio que fazia a fatura de julho, enviada em agosto, ser gravada como agosto.

Datas vão para a planilha como **texto** (`setNumberFormat('@')`), senão o Sheets converte em `Date` e devolve dia/mês trocados conforme o locale. A lógica de formatação vive só em [js/formato.js](js/formato.js) — antes eram três cópias que divergiam entre si.

## Parser de fatura — o PDF é a fonte de verdade

[js/parser-bradesco.js](js/parser-bradesco.js) roda no navegador com pdf.js. **Só aceita PDF.** O CSV foi descartado porque não traz a data de vencimento nem o total por cartão — sem eles não há como conferir se a conta fechou.

Como funciona:

1. Agrupa os textos do PDF em linhas **pela posição vertical**, não pelo fluxo de leitura. Partes da mesma linha chegam a diferir 0,04pt; o fluxo de leitura quebra o cabeçalho em dois quando titular e valor ficam distantes na horizontal, e aí a seção perde o total declarado.
2. Cada seção começa em `Gastos referentes ao cartão: Final XXXX | TITULAR` e termina em `Total da fatura (final` / `Resumo das Despesas` / `Taxas Mensais`. **Sem o marcador de fim a última seção engole as tabelas de resumo** e o total estoura.
3. A data vem em linhas soltas (`24` … `JUN`), com o mês aparecendo *depois* do primeiro lançamento — lançamentos ficam pendentes até o mês chegar.
4. O produto vem do cartão da capa (`**** **** **** 2737`), porque o nome (Infinite/Æternum) não está escrito no PDF.

**A conferência é a razão de existir do parser.** A soma dos lançamentos de cada cartão tem de bater ao centavo com o `Valor da fatura` que o banco imprime, e a soma das seções com o total da fatura. Se não bater, `salvarFatura` recusa e nada é publicado. Foi a ausência disso que deixou passar a diferença de R$400.

## Testar

```bash
cd testes && npm install && npm test
```

Três suítes sobre 5 faturas reais (maio–agosto/2026): parser ao centavo em 18 seções, fluxo ponta a ponta até o resumo, e renderização das telas. Veja [testes/README.md](testes/README.md). Os PDFs ficam em `testes/faturas/` e **não vão para o git**.

Para a interface, sem backend de desenvolvimento:

```bash
python3 -m http.server 8000
```

O login bate na `apiUrl` de produção — qualquer teste de ponta a ponta grava na planilha real.

## Débitos conhecidos

- **Senha em SHA-256 sem salt.** Trocar obriga a redefinir as senhas dos dois.
- **`getFatura` e `listarFaturas` varrem a aba inteira** a cada chamada. Com poucos meses é irrelevante; se crescer, indexe.
- **Abas antigas** (`faturas`, `lancamentos`) continuam na planilha com os dados da v1, em reais e com vencimento errado. Ficaram para conferência — podem ser apagadas depois.
- **Um banco só.** A estrutura aceita outros, mas o parser é específico do layout do Bradesco.

## Convenções

Código, comentários, commits e UI em **português**. Commits seguem `tipo: descrição` (`fix:`, `feat:`, `style:`, `chore:`) — veja o `git log`. Identificadores em português também (`fatura`, `lancamento`, `vencimento`, `mesAno`).

O CSS usa custom properties definidas em `:root` no topo de [css/style.css](css/style.css#L11); prefira os tokens (`--brand-blue`, `--text-muted`, `--radius-md`, `--danger`) a valores literais — embora muito estilo esteja inline nos templates JS.

## graphify

O projeto tem um grafo de conhecimento em `graphify-out/`, com god nodes e relações entre arquivos. Regras (ver também *Antes de mexer* no topo):

- Para qualquer pergunta sobre o código, rode `graphify query "<pergunta>"` primeiro, enquanto `graphify-out/graph.json` existir. Use `graphify path "<A>" "<B>"` para relações e `graphify explain "<conceito>"` para um ponto focado. Os três devolvem um subgrafo escopado, bem menor que o `GRAPH_REPORT.md` ou um `grep` cru.
- Leia `graphify-out/GRAPH_REPORT.md` só para revisão ampla de arquitetura, ou quando `query`/`path`/`explain` não trouxerem contexto suficiente.
- Depois de mexer **no código**, rode `graphify update .` (só AST, sem custo de API).
- `graphify-out/graph.html` é o grafo interativo — abre direto no browser, sem servidor.

Os hooks em [.claude/settings.json](.claude/settings.json) lembram disso automaticamente antes de buscas e leituras.

### Ao reextrair um documento — duas armadilhas já pagas

O grafo cobre código **e** documentação. Mudança em `.md` exige `/graphify --update` (extração semântica), não `graphify update .`. Duas coisas quebram nesse caminho, ambas já custaram um rebuild aqui:

1. **`graphify update .` num documento alterado degrada o grafo.** Ele reextrai só código, mas o merge descarta o que veio do arquivo alterado. Medido neste projeto: 217 → 193 arestas, 16 → 52 comunidades. Se acontecer, o grafo curado anterior está salvo em `graphify-out/AAAA-MM-DD/` — restaure de lá e refaça pelo caminho certo.
2. **Reextração substitui todos os nós daquele arquivo.** Se os IDs novos não forem idênticos aos antigos, as arestas *de outros arquivos* que apontavam para eles ficam órfãs e somem no merge (foi assim que 7 arestas README↔CLAUDE.md se perderam). Antes de reextrair um documento, colete os IDs atuais e mande o subagente reusá-los literalmente:

```bash
$(cat graphify-out/.graphify_python) -c "
import json; from pathlib import Path
g=json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
print([n['id'] for n in g['nodes'] if n.get('source_file')=='CLAUDE.md'])"
```

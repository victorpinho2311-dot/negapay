# Graph Report - .  (2026-08-07)

## Corpus Check
- 15 files · ~28,024 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 227 nodes · 387 edges · 17 communities
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.84)
- Token cost: 35,344 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend Apps Script|Backend Apps Script]]
- [[_COMMUNITY_Parser, Dinheiro e Conferência|Parser, Dinheiro e Conferência]]
- [[_COMMUNITY_Frontend, UI e Navegação|Frontend, UI e Navegação]]
- [[_COMMUNITY_Contrato da API e Configuração|Contrato da API e Configuração]]
- [[_COMMUNITY_Teste ponta a ponta|Teste ponta a ponta]]
- [[_COMMUNITY_Teste de renderização|Teste de renderização]]
- [[_COMMUNITY_Manifesto PWA|Manifesto PWA]]
- [[_COMMUNITY_Dependências dos testes|Dependências dos testes]]
- [[_COMMUNITY_Config do Apps Script|Config do Apps Script]]
- [[_COMMUNITY_Arte do Cartão Bradesco|Arte do Cartão Bradesco]]
- [[_COMMUNITY_Teste do parser|Teste do parser]]
- [[_COMMUNITY_Ícone do App 512px|Ícone do App 512px]]
- [[_COMMUNITY_Workflow graphify|Workflow graphify]]
- [[_COMMUNITY_Identidade Visual Bradesco|Identidade Visual Bradesco]]
- [[_COMMUNITY_Ícone do App 192px|Ícone do App 192px]]
- [[_COMMUNITY_Deploy e Cache-busting|Deploy e Cache-busting]]

## God Nodes (most connected - your core abstractions)
1. `doGet()` - 15 edges
2. `getAba()` - 13 edges
3. `validarToken()` - 11 edges
4. `getResumo()` - 10 edges
5. `Admin` - 10 edges
6. `Padrão IIFE expondo global (Auth, API, Fmt, ParserBradesco, Admin, Primo)` - 10 edges
7. `Tags <script> com cache-busting ?v=20260807-1 (ordem importa)` - 10 edges
8. `enviarNotificacaoFatura()` - 9 edges
9. `ParserBradesco` - 9 edges
10. `Parser de fatura Bradesco — o PDF é a fonte de verdade` - 9 edges

## Surprising Connections (you probably didn't know these)
- `UI.init() — sessão existente, loading e binds de teclado` --references--> `validarToken()`  [INFERRED]
  index.html → appscript/Code.js
- `Uso mensal — Getúlio vê um valor e o detalhe por fatura` --references--> `getResumo()`  [INFERRED]
  README.md → appscript/Code.js
- `e2e.test.js — PDF → parser → regra do backend → resumo` --references--> `getResumo()`  [INFERRED]
  testes/README.md → appscript/Code.js
- `Uso mensal — Pinho arrasta o PDF, confere e publica` --references--> `Admin`  [INFERRED]
  README.md → js/admin.js
- `O ponto principal: o app confere a própria conta` --references--> `ParserBradesco`  [INFERRED]
  README.md → js/parser-bradesco.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fluxo de publicação de fatura: PDF → parser → conferência → salvarFatura** — claude_parser_bradesco_pdf, claude_conferencia_ao_centavo, claude_dinheiro_centavos, claude_salvarfatura, readme_uso_admin [INFERRED 0.85]
- **Regras de vencimento, mesAno e persistência de datas** — claude_vencimento_lido_do_pdf, claude_mesano_do_vencimento, claude_datas_como_texto_sheets, claude_formato_js_fonte_unica [INFERRED 0.85]
- **Suíte de testes sobre faturas reais** — testes_readme_parser_test, testes_readme_e2e_test, testes_readme_render_test, testes_readme_faturas_pdfs [EXTRACTED 1.00]
- **Premium Tier Signalling on the Card Face** — assets_bradesco_card_bradesco_prime, assets_bradesco_card_visa_infinite, assets_bradesco_card_dark_premium_visual_identity, assets_bradesco_card_numberless_face_design [INFERRED 0.80]
- **Bradesco Prime Visual Identity System** — assets_bradesco_logo_image, assets_bradesco_logo_tree_symbol, assets_bradesco_logo_blue_gradient_palette, assets_bradesco_logo_bradesco_prime_brand [INFERRED 0.85]
- **NegaPay Brand Mark Composition (gradient field + card glyph + rising arrow)** — assets_icon_192_green_to_blue_gradient, assets_icon_192_invoice_card_glyph, assets_icon_192_upward_arrow_motif, assets_icon_192_app_icon [EXTRACTED 1.00]
- **NegaPay Icon Visual Composition (card + arrow + gradient)** — assets_icon_512_paymentcardglyph, assets_icon_512_growtharrow, assets_icon_512_gradientbackdrop, assets_icon_512_appicon [EXTRACTED 1.00]

## Communities (17 total, 0 thin omitted)

### Community 0 - "Backend Apps Script"
Cohesion: 0.16
Nodes (33): apagarLancamentos(), chaveCompetencia(), chaveVencimento(), COLS_CARTOES, COLS_FATURAS, COLS_LANCAMENTOS, definirDonoCartao(), doGet() (+25 more)

### Community 1 - "Parser, Dinheiro e Conferência"
Cohesion: 0.11
Nodes (31): Agrupamento de textos em linhas pela posição vertical, Conferência ao centavo contra o Valor da fatura declarado, Convenções: código, comentários, commits e UI em português, Data em linhas soltas com o mês chegando depois do lançamento, Datas gravadas como texto na planilha (setNumberFormat('@')), Débito: abas antigas faturas/lancamentos com dados da v1, Débito: um banco só — parser específico do layout Bradesco, Dinheiro em CENTAVOS inteiros do parser à planilha (+23 more)

### Community 2 - "Frontend, UI e Navegação"
Cohesion: 0.15
Nodes (24): Arquitetura: GitHub Pages → Apps Script → Google Sheets, Navegação por três div.page e classe .active, sem router, Padrão IIFE expondo global (Auth, API, Fmt, ParserBradesco, Admin, Primo), Render via innerHTML com template strings e onclick inline, Tokens CSS em :root (--brand-blue, --text-muted, --radius-md, --danger), UI.fazerLogin(), UI.init() — sessão existente, loading e binds de teclado, UI.logout() (+16 more)

### Community 3 - "Contrato da API e Configuração"
Cohesion: 0.13
Nodes (21): criarAba(), setupV2(), API.post() usa GET com ?payload=<JSON url-encoded>, Dono do cartão vive na aba cartoes, não no código, js/config.js — apiUrl, produtos e textos, Contrato da API — ações e envelope { ok: true/false }, Débito: getFatura e listarFaturas varrem a aba inteira, Débito: senha em SHA-256 sem salt (+13 more)

### Community 4 - "Teste ponta a ponta"
Cohesion: 0.13
Nodes (13): assert, BASE, chaveCompetencia(), DONOS, ESPERADO, faturas, Fmt, fs (+5 more)

### Community 5 - "Teste de renderização"
Cohesion: 0.14
Nodes (12): arquivo(), assert, CARTOES_CONHECIDOS, dom, enviar(), esperar(), fs, { JSDOM } (+4 more)

### Community 6 - "Manifesto PWA"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 7 - "Dependências dos testes"
Cohesion: 0.18
Nodes (10): dependencies, jsdom, pdfjs-dist, name, private, scripts, e2e, parser (+2 more)

### Community 8 - "Config do Apps Script"
Cohesion: 0.25
Nodes (7): dependencies, exceptionLogging, runtimeVersion, timeZone, webapp, access, executeAs

### Community 9 - "Arte do Cartão Bradesco"
Cohesion: 0.39
Nodes (8): Bradesco Prime (Issuer Brand), Contactless Payment Symbol, Dark Premium Visual Identity (Black Face, Angular Highlights), EMV Chip Element, Bradesco Prime Card Image Asset, Numberless Card Face Design, Card Artwork for NegaPay UI, Visa Infinite (Card Network Tier)

### Community 10 - "Teste do parser"
Cohesion: 0.25
Nodes (6): ARQS, BASE, fs, Parser, path, pdfjsLib

### Community 11 - "Ícone do App 512px"
Cohesion: 0.43
Nodes (7): NegaPay App Icon (512px), NegaPay Visual Brand Identity, Flat Monochrome-on-Gradient Icon Style, Green-to-Blue Diagonal Gradient Backdrop, Upward Growth Arrow Motif, Payment/Billing Card Glyph, PWA Launcher Icon Asset (512x512)

### Community 12 - "Workflow graphify"
Cohesion: 0.43
Nodes (7): GRAPH_REPORT.md — só para revisão ampla de arquitetura, Grafo de conhecimento em graphify-out/ (144 nós, 217 arestas, 16 comunidades), graphify query / path / explain — subgrafo escopado, graphify update . — reprocessa só código (AST, sem custo de API), Hooks em .claude/settings.json lembram do grafo antes de buscas, Reextração de documento — reusar IDs para não orfanar arestas, Workflow obrigatório: antes de mexer, consulte o grafo

### Community 13 - "Identidade Visual Bradesco"
Cohesion: 0.60
Nodes (6): Bank Branding Asset Convention, Deep Blue Gradient Brand Palette, Bradesco Prime (Brazilian Bank Brand), Bradesco Prime Logo Asset, Payment Provider Visual Identity in NegaPay, Bradesco Stylized Tree Symbol

### Community 14 - "Ícone do App 192px"
Cohesion: 0.53
Nodes (6): NegaPay App Icon (192x192), Green-to-Cyan/Blue Diagonal Gradient Background, Tilted Invoice/Bill Card Glyph, Payment Dispatch / Send-Bill Visual Metaphor, PWA Launcher Icon Asset (192px manifest size), Upward Diagonal Arrow Motif

### Community 15 - "Deploy e Cache-busting"
Cohesion: 0.40
Nodes (6): Cache-busting ?v=AAAAMMDD-N nas tags script/link, Deploy do frontend — git push para main, GitHub Pages publica, sw.js neutralizado (não cacheia nada), Teste local de interface com python3 -m http.server 8000, Setup 2 — frontend: push para main, GitHub Pages publica, Atualizar o ?v= nas tags do index.html ao mexer em js/ ou css/

## Knowledge Gaps
- **59 isolated node(s):** `timeZone`, `dependencies`, `exceptionLogging`, `runtimeVersion`, `executeAs` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Admin` connect `Frontend, UI e Navegação` to `Parser, Dinheiro e Conferência`, `Teste de renderização`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `enviar()` connect `Teste de renderização` to `Frontend, UI e Navegação`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `validarToken()` connect `Backend Apps Script` to `Frontend, UI e Navegação`, `Contrato da API e Configuração`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `getResumo()` (e.g. with `Uso mensal — Getúlio vê um valor e o detalhe por fatura` and `e2e.test.js — PDF → parser → regra do backend → resumo`) actually correct?**
  _`getResumo()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Admin` (e.g. with `div#page-admin (Pinho) — admin-upload e admin-historico` and `Uso mensal — Pinho arrasta o PDF, confere e publica`) actually correct?**
  _`Admin` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `timeZone`, `dependencies`, `exceptionLogging` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Parser, Dinheiro e Conferência` be split into smaller, more focused modules?**
  _Cohesion score 0.1053763440860215 - nodes in this community are weakly interconnected._
# Testes

Conferem que o valor que o Getúlio vê é o mesmo que o banco declarou na fatura.

```bash
cd testes
npm install
npm test
```

## As faturas

`testes/faturas/` guarda os PDFs usados como referência. **Não vão para o git** —
são faturas reais. Se a pasta estiver vazia (clone novo), coloque ali os PDFs
com estes nomes:

| arquivo | fatura |
|---|---|
| `infinite-05.pdf` | Maio · Visa Infinite |
| `infinite-06.pdf` | Junho · Visa Infinite |
| `infinite-07.pdf` | Julho · Visa Infinite |
| `infinite-08.pdf` | Agosto · Visa Infinite |
| `aeternum-08.pdf` | Agosto · Visa Æternum |

## O que cada um cobre

- **parser.test.js** — lê os 5 PDFs e exige que a soma dos lançamentos de cada
  cartão bata, ao centavo, com o `Valor da fatura` que o próprio banco imprime.
  18 seções, 377 lançamentos.
- **e2e.test.js** — PDF → parser → regra do backend → resumo. Confere os totais
  por mês contra valores calculados à mão, e prova que duas faturas no mesmo mês
  coexistem (o bug que fazia a Æternum apagar a Infinite).
- **render.test.js** — renderiza as telas com dados reais num DOM de mentira.
  Garante que a publicação trava com cartão sem dono e que descrição de
  lançamento é escapada antes de virar HTML.

## Ao mudar o parser

Rode `npm test` antes de publicar. Se um PDF novo do Bradesco vier num layout
diferente, o parser vai acusar divergência em vez de publicar valor errado —
guarde esse PDF em `testes/faturas/` e ele vira caso de teste.

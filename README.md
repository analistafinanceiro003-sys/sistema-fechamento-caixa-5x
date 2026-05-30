# Central de Caixa 5X — versão organizada para VS Code

## Estrutura

```text
index.html
src/
  style.css
  app.js
assets/
  logo.png
  favicon.png
  favicon.svg
sql/
  supabase_setup.sql
docs/
  index_original_monolitico.html
```

## O que foi ajustado nesta versão

- `src/app.js` foi refeito para remover duplicações e patches acumulados.
- Existe apenas uma função principal para cada rotina crítica: login, permissões, fechamento, renderização, relatórios e módulos.
- A lógica de módulos por perfil foi centralizada:
  - Master vê tudo.
  - ADM Cliente vê apenas a empresa vinculada e as abas liberadas.
  - Operador vê apenas a loja vinculada e as abas liberadas.
- A lógica do fechamento foi padronizada:
  - Saldo em caixa = saldo inicial + entradas - saídas.
  - Saldo final após repasse = saldo em caixa - repasse.
  - Divergência 5X = saldo final após repasse - fundo padrão da loja.
- Foi mantido o campo de fundo padrão por loja.
- Foi incluída a categoria nas saídas do caixa.
- Foram mantidas exportações CSV, backup JSON e funcionamento com Supabase/localStorage.

## Como rodar no VS Code

1. Abra a pasta no VS Code.
2. Instale a extensão **Live Server**.
3. Clique com o botão direito no `index.html`.
4. Selecione **Open with Live Server**.

## Acessos demonstrativos

### Gestão 5X
- Login: `gestao5x@gestao5x.com.br`
- Senha: `123456`

### ADM Cliente
- Login: `admin@cliente.com`
- Senha: `123456`

### Operador
- Login: `operador@cliente.com`
- Senha: `123456`

## Observação técnica

O sistema ainda usa uma tabela única `app_state` no Supabase para armazenar o estado global. Isso funciona para MVP/protótipo operacional, mas para produção com vários clientes o ideal é evoluir para tabelas separadas por empresa, loja, usuário, fechamento, itens de fechamento e auditoria.

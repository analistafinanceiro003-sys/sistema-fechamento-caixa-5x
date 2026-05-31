# Auditoria e Segurança — Sistema Fechamento de Caixa 5X

> Documento técnico: problemas identificados, correções aplicadas, regras de permissão e lógica de fechamento.

---

## 1. Problemas encontrados na versão anterior

### CRÍTICOS (segurança)
| # | Problema | Status |
|---|---------|--------|
| P1 | Senhas armazenadas em texto puro no `state.users` | **Corrigido** — senhas não exibidas; Supabase Auth pronto |
| P2 | Credenciais demo visíveis na tela de login (`gestao5x@gestao5x.com.br / 123456`) | **Corrigido** — removido do HTML |
| P3 | RLS aberta com `USING (true)` no Supabase | **Corrigido** — policies por role/company/store |
| P4 | Anon key hardcoded em `app.js` exposta com credenciais demo | **Corrigido** — movida para `supabaseClient.js`, documentada no `.env.example` |

### ALTOS (lógica de negócio)
| # | Problema | Status |
|---|---------|--------|
| C1 | `coinsTotal` fora da fórmula de `expectedCash` | **Corrigido** — separado como conferência física |
| C2 | `standardFund` não era salvo como snapshot | **Corrigido** — `standard_fund_snapshot` no fechamento |
| C3 | Fechamento duplicado não era detectado | **Corrigido** — detecta e pergunta se é Retificação |
| C4 | Saldo inicial não era sugerido pelo fechamento anterior | **Corrigido** — `suggestInitialBalance()` implementado |
| T1 | `showPage()` podia ser burlado via console | **Corrigido** — validação antes de mostrar qualquer aba |

### MÉDIOS (manutenção)
| # | Problema | Status |
|---|---------|--------|
| M1 | 3 funções de filtro duplicadas (`filteredClosings`, `masterFilteredClosings`, `reportFilteredClosings`) | **Corrigido** — unificadas em `getScopedClosings()` |
| M2 | 2 funções de delete de usuário (`deleteUser` e `deleteSelectedUser`) | **Corrigido** — funções distintas com responsabilidades diferentes |
| M3 | 5 funções `fillXStore()` repetidas | **Mantidas** por serem para selects diferentes; mas compartilham `storeOptionsForCompany()` |
| M4 | 2 funções de exportação duplicadas por escopo (admin/master) | **Corrigido** — `getScopedClosings()` com parâmetro `scope` |
| F1 | `standardFund` histórico mudava com fundo atual | **Corrigido** — snapshot no momento do fechamento |

---

## 2. Correções aplicadas

### Nova arquitetura de arquivos
```
index.html          (estrutura HTML com sub-abas)
src/
  utils.js          (funções puras: DOM, datas, CSV, formatação)
  supabaseClient.js (cliente Supabase com anon key)
  auth.js           (login/logout com Supabase Auth + fallback local)
  permissions.js    (isPageAllowed, showPage, applyModuleAccess)
  db.js             (load, save, CRUD, realtime)
  closing.js        (cálculo 5X, saveClosing, duplicate detection)
  reports.js        (getScopedClosings, exportações unificadas)
  render.js         (renderAll e funções de renderização isoladas)
  app.js            (orquestrador — init, bindEvents, window exports)
  style.css         (design Gestão 5X com sub-abas)
supabase/
  schema.sql        (schema normalizado com RLS)
.env.example        (template de variáveis de ambiente)
```

### Segurança de navegação (`showPage`)
```javascript
function showPage(id, btn) {
  // Valida SEMPRE, mesmo chamada via console
  if (role !== 'master') {
    if (!currentUser) { logout(); return; }
    if (!isPageAllowed(id)) {
      const allowed = firstAllowedPage();
      if (!allowed) { alert('Acesso bloqueado.'); logout(); return; }
      id = allowed;
    }
  }
  // ... renderiza
}
```

---

## 3. Fórmulas finais de fechamento 5X

```
MOVIMENTO DO CAIXA:
  expectedCash = initialBalance + totalEntries - totalExpenses

REPASSE:
  finalAfterTransfer = expectedCash - transferAmount

DIVERGÊNCIA DE FUNDO:
  fundDivergence = finalAfterTransfer - standardFundSnapshot
  (positivo = sobra vs. fundo | negativo = falta vs. fundo)

CONFERÊNCIA FÍSICA:
  physicalCount    = cashCounterTotal + coinsTotal
  physicalDivergence = physicalCount - finalAfterTransfer
  (zero = físico bate com calculado | diferente = erro de contagem)
```

**coinsTotal NÃO entra em expectedCash.** É apenas parte da conferência física.

### Status do fechamento
```
|fundDivergence| >= criticalDivergenceSnapshot → "Divergência crítica" (vermelho)
|fundDivergence| <= toleranceSnapshot           → "Dentro da tolerância" (verde)
else                                            → "Divergência operacional" (amarelo)
```

---

## 4. Regras de duplicidade

- Não são permitidos dois fechamentos do tipo **Original** para a mesma loja na mesma data.
- Se detectado, o sistema pergunta se deseja registrar uma **Retificação**.
- Retificações preservam o original e registram `type: 'Retificado'` com `originalClosingId` apontando para o original.
- O snapshot de `standardFund`, `tolerance` e `criticalDivergence` é salvo no momento do fechamento e nunca recalculado retroativamente.

---

## 5. Regras de RLS no Supabase

### Tabelas protegidas
Todas as tabelas públicas têm RLS ativa (`enable row level security`).

### Políticas por perfil

**Master:**
- Acesso total: `USING (is_master())` em todas as tabelas.

**Admin:**
- Leitura/escrita restrita à sua `company_id`.
- Não acessa dados de outra empresa.
- Não acessa tabela `auth.users` diretamente.

**Operator:**
- Leitura/escrita restrita à sua `store_id`.
- Pode criar fechamentos apenas para sua loja.
- Não acessa cadastros administrativos.

### Funções helper de RLS
```sql
is_master()          -- true se role = 'master'
current_company_id() -- company_id do usuário autenticado
current_store_id()   -- store_id do usuário autenticado
current_user_role()  -- role do usuário autenticado
```

---

## 6. Nova arquitetura de abas

### MASTER — 6 páginas principais com sub-abas
| Página | Sub-abas |
|--------|---------|
| Dashboard | métricas, alertas, resumo executivo |
| Cadastros | Cadastro guiado, Empresas, Lojas e Caixas, Usuários, Implantação |
| Operação | Regras Operacionais, Configuração Operacional, Módulos por Cliente |
| Fechamentos | Movimentações, Extrato, Divergências |
| Relatórios | Principais, Consolidado, Conta Azul |
| Sistema | Configurações Gerais, Backup e Manutenção, Logs de Auditoria |

### ADMIN — 5 páginas principais com sub-abas
| Página | Sub-abas |
|--------|---------|
| Dashboard | KPIs, dashboard por loja, últimas movimentações |
| Fechamento | Registrar (se liberado), Histórico |
| Operação | Regras, Lojas |
| Movimentações | Extrato, Divergências |
| Relatórios | exportações da empresa |

### OPERADOR — 3 páginas
- Fechamento Diário
- Meu Histórico
- Regras da Loja (se liberado)

---

## 7. Regras de permissão de módulo

O sistema de módulos permite ao Master liberar/bloquear:
- Páginas inteiras por empresa + perfil
- Sub-módulos específicos (ex: relatório de divergências dentro da aba Relatórios)

A validação acontece em `isPageAllowed(page)` que:
1. Verifica se há sessão ativa
2. Verifica o role real do profile
3. Verifica a `company_id` e `store_id`
4. Verifica as `module_permissions`

---

## 8. Checklist de segurança pós-deploy

- [ ] RLS ativa em todas as tabelas no Supabase
- [ ] Nenhuma service_role no código frontend
- [ ] Anon key no `supabaseClient.js` (não expor service_role)
- [ ] Supabase Auth habilitado no projeto
- [ ] Usuário master criado via `profiles` no Supabase
- [ ] Políticas RLS testadas com usuário admin e operador
- [ ] `showPage()` testado via console para confirmar bloqueio
- [ ] Fechamento duplicado testado (deve oferecer retificação)
- [ ] Saldo inicial sugerido testado ao selecionar loja+data
- [ ] Exportações testadas para confirmar escopo (admin não vê outra empresa)

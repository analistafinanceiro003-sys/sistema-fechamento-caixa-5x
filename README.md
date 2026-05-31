# Central de Fechamento de Caixa 5X

Sistema operacional de fechamento de caixa para múltiplas empresas e lojas, com governança, divergências e relatórios.

**Tecnologia:** HTML5 + CSS3 + JavaScript puro + Supabase (Auth + Database + Realtime)

---

## Arquitetura

```
index.html              Estrutura HTML com navegação por sub-abas
src/
  utils.js              Utilitários (DOM, datas, CSV, formatação)
  supabaseClient.js     Cliente Supabase (anon key apenas)
  auth.js               Autenticação (Supabase Auth + fallback local)
  permissions.js        Controle de acesso e navegação segura
  db.js                 Persistência, CRUD e Realtime
  closing.js            Lógica de fechamento 5X e cálculos
  reports.js            Filtros unificados e exportações CSV
  render.js             Renderização de UI por módulo
  app.js                Orquestrador e inicialização
  style.css             Estilos Gestão 5X
supabase/
  schema.sql            Schema SQL completo com RLS
.env.example            Template de variáveis de ambiente
docs/
  AUDITORIA_E_SEGURANCA.md  Auditoria técnica e decisões de arquitetura
backup/                 Arquivos originais (antes da refatoração)
```

---

## Como rodar com Live Server

1. Abra a pasta no VS Code
2. Instale a extensão **Live Server** (Ritwick Dey)
3. Clique com botão direito em `index.html` → "Open with Live Server"
4. O sistema abre em `http://127.0.0.1:5500`

> Sem build, sem npm, sem Node.js necessários.

---

## Como configurar o Supabase

### 1. Criar o projeto
1. Acesse [supabase.com](https://supabase.com) e crie um projeto
2. Anote a **Project URL** e a **anon key** (Settings → API)

### 2. Executar o schema
1. Abra o **SQL Editor** no painel do Supabase
2. Cole e execute o conteúdo de `supabase/schema.sql`
3. Verifique que todas as tabelas foram criadas com RLS ativa

### 3. Configurar credenciais no frontend
Edite `src/supabaseClient.js`:
```javascript
const SUPABASE_URL      = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'sua_anon_key_aqui';
```

> **NUNCA** coloque a `service_role` key no frontend.

### 4. Habilitar Supabase Auth
- Authentication → Settings → habilite "Email/Password"

### 5. Criar o primeiro usuário Master
1. Authentication → Users → Add User (e-mail + senha)
2. Copie o UUID gerado
3. Execute no SQL Editor:
```sql
insert into public.profiles (user_id, name, email, role, status)
values (
  'UUID_COPIADO_AQUI',
  'Gestão 5X',
  'adm@gestao5x.com.br',
  'master',
  'Ativo'
);
```

---

## Como criar usuários Admin e Operador

```sql
-- Admin de cliente
insert into public.profiles (user_id, name, email, role, company_id, status)
values ('UUID','Nome Admin','admin@empresa.com','admin','UUID_EMPRESA','Ativo');

-- Operador
insert into public.profiles (user_id, name, email, role, company_id, store_id, status)
values ('UUID','Nome Operador','op@empresa.com','operator','UUID_EMPRESA','UUID_LOJA','Ativo');
```

---

## Perfis de acesso

| Perfil | Acesso |
|--------|--------|
| Master (Gestão 5X) | Todas as empresas, módulos e configurações |
| Admin Cliente | Apenas sua empresa — dashboard, fechamentos, relatórios |
| Operador | Apenas sua loja — fechamento diário e histórico |

Em modo local (sem Supabase configurado), os usuários de `state.users` continuam funcionando como fallback.

---

## Fórmulas de Fechamento 5X

```
expectedCash       = saldo_inicial + entradas - saídas
finalAfterTransfer = expectedCash - repasse
fundDivergence     = finalAfterTransfer - fundo_padrão_snapshot
physicalCount      = cédulas_contadas + moedas_contadas
physicalDivergence = physicalCount - finalAfterTransfer
```

`coinsTotal` (moedas) **não** entra em `expectedCash`. Faz parte da conferência física.

---

## Checklist pós-deploy

- [ ] `supabase/schema.sql` executado
- [ ] Usuário Master criado em Auth + profiles
- [ ] Login de Admin e Operador testado
- [ ] `showPage('relatorios')` via console bloqueado para Admin/Operator
- [ ] Fechamento duplicado oferece retificação
- [ ] Saldo inicial sugerido ao selecionar loja + data
- [ ] Relatório Admin não exibe dados de outra empresa

---

Consulte `docs/AUDITORIA_E_SEGURANCA.md` para detalhes técnicos completos.

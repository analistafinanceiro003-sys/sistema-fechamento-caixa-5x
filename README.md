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
  functions/create-user Edge Function para criação segura de usuários
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

Depois que o usuário Master existir em Supabase Auth + `public.profiles`, a criação de Admin e Operador deve ser feita pela tela **Usuários e Acessos** do sistema.

O frontend chama a Edge Function `create-user`. A senha vai apenas na requisição segura para a função, não é salva no frontend nem no `localStorage`. A função cria o usuário em **Authentication > Users** e, em seguida, cria o registro correspondente em `public.profiles`.

### Deploy da Edge Function

Com a Supabase CLI autenticada no projeto:

```bash
supabase functions deploy create-user
supabase functions deploy delete-user
```

### Secrets obrigatórios

Configure os secrets no projeto Supabase:

```bash
supabase.cmd secrets set PROJECT_URL=https://feopuubmozroxavuxcly.supabase.co --project-ref feopuubmozroxavuxcly
supabase.cmd secrets set SERVICE_ROLE_KEY=SUA_SECRET_KEY --project-ref feopuubmozroxavuxcly
```

> A `SERVICE_ROLE_KEY` fica somente no ambiente seguro da Edge Function. Nunca coloque essa chave no frontend.

### Como testar

1. Faça login no sistema com um usuário `master`.
2. Acesse **Usuários e Acessos**.
3. Crie um Admin informando empresa, nome, e-mail e senha.
4. Crie um Operador informando empresa, loja, nome, e-mail e senha.
5. No painel Supabase, verifique:
   - **Authentication > Users** contém os e-mails criados.
   - **Table Editor > public.profiles** contém os registros com `role`, `company_id` e, para operador, `store_id`.
6. Saia do sistema e teste login com o novo Admin/Operador.

### Deploy das Edge Functions no projeto 5X

```bash
supabase.cmd functions deploy create-user --project-ref feopuubmozroxavuxcly
supabase.cmd functions deploy delete-user --project-ref feopuubmozroxavuxcly
```

Se a `create-user` já estiver publicada e apenas a exclusão tiver sido adicionada:

```bash
supabase.cmd functions deploy delete-user --project-ref feopuubmozroxavuxcly
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
- [ ] Edge Function `create-user` publicada
- [ ] Secrets `PROJECT_URL` e `SERVICE_ROLE_KEY` configurados
- [ ] Usuário Master criado em Auth + profiles
- [ ] Criação de Admin/Operador testada pela tela Usuários e Acessos
- [ ] Login de Admin e Operador testado
- [ ] `showPage('relatorios')` via console bloqueado para Admin/Operator
- [ ] Fechamento duplicado oferece retificação
- [ ] Saldo inicial sugerido ao selecionar loja + data
- [ ] Relatório Admin não exibe dados de outra empresa

---

Consulte `docs/AUDITORIA_E_SEGURANCA.md` para detalhes técnicos completos.

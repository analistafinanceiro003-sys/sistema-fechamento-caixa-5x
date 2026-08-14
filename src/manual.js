'use strict';

/* ============================================================
   MANUAL 5X
   Conteudo da aba Manual 5X e do PDF do manual.
   Mantido isolado para nao interferir nas telas operacionais.
============================================================ */

const manualSections5x = [
  {
    key: 'overview',
    tab: 'Visao Geral',
    title: 'Manual 5X - Como ler a operacao',
    lead: 'Use este manual como guia de leitura do sistema. Ele explica o que cada tela mostra, quais campos precisam ser preenchidos e como interpretar os relatorios antes de orientar o cliente.',
    cards: [
      {
        title: 'Fluxo padrao do caixa',
        type: 'steps',
        items: [
          ['1. Cadastro', 'A Gestao 5X cadastra Empresa, Lojas / Caixas, Usuarios e as opcoes permitidas de Cliente, Fornecedor, Categoria, Conta Financeira Conta Azul e Centro de Custo Conta Azul.'],
          ['2. Fechamento Diario', 'O operador informa Saldo inicial informado, Entradas, Saidas, Repasse informado, Observacoes e Anexos.'],
          ['3. Conferencia', 'O sistema calcula Saldo antes do repasse, Repasse sugerido, Saldo final e Divergencia. O gestor confirma o repasse recebido.'],
          ['4. Analise', 'Analista e gestor acompanham Historico, Extrato, Divergencias, Repasses e Relatorios.'],
          ['5. Conta Azul', 'Depois da previa, os lancamentos sao revisados, aprovados e enviados para a Conta Financeira Conta Azul selecionada.'],
        ],
      },
      {
        title: 'Principio de leitura',
        body: '<p>O sistema nao deve ser usado para "forcar" o caixa a bater. O operador registra o valor real. Se houver diferenca, ela fica visivel para analise, justificativa e retificacao quando necessario.</p>',
        tone: 'info',
      },
      {
        title: 'Telas mais usadas pelo analista',
        type: 'table',
        headers: ['Tela', 'Para que serve', 'Quando usar'],
        rows: [
          ['Fechamento Diario', 'Registrar ou acompanhar o fechamento de uma loja.', 'Quando precisar orientar operador ou conferir campos obrigatorios.'],
          ['Historico', 'Ver fechamentos ja salvos por data, empresa, loja e responsavel.', 'Quando o cliente pergunta sobre um fechamento especifico.'],
          ['Extrato', 'Listar entradas e saidas com totais.', 'Quando precisar entender de onde vieram os movimentos.'],
          ['Repasses', 'Confirmar ou analisar valores entregues ao caixa central.', 'Quando houver repasse pendente, nao repassado ou com diferenca.'],
          ['Divergencias', 'Acompanhar diferencas de fundo e abertura.', 'Quando o caixa nao fechou com o fundo esperado.'],
          ['Relatorios', 'Exportar PDF, Excel e modelo Conta Azul.', 'Fechamento mensal, conferencia do financeiro e integracao.'],
        ],
      },
    ],
  },
  {
    key: 'fechamento',
    tab: 'Fechamento',
    title: 'Fechamento Diario - campos e validacoes',
    lead: 'O fechamento diario e o registro oficial do dinheiro fisico da loja no fim do turno ou do dia.',
    cards: [
      {
        title: 'Campos da tela',
        type: 'table',
        headers: ['Campo', 'O que preencher', 'Regra'],
        rows: [
          ['Saldo inicial informado', 'Dinheiro contado no caixa antes de iniciar a conferencia.', 'Deve refletir o valor fisico real. Se diferente do esperado, explicar em Observacoes.'],
          ['Descricao', 'Texto claro do lancamento de entrada ou saida.', 'Obrigatorio. Use nomes objetivos, por exemplo: Entrada em Dinheiro, Almoco colaboradoras, Taxa de entrega.'],
          ['Categoria', 'Categoria liberada para aquela empresa e tipo de lancamento.', 'Obrigatorio. Deve vir das categorias sincronizadas/liberadas ou cadastradas para a empresa.'],
          ['Cliente', 'Cliente vinculado a uma entrada.', 'Obrigatorio para entradas. Deve ser selecionado na lista cadastrada/liberada.'],
          ['Fornecedor', 'Fornecedor vinculado a uma saida.', 'Obrigatorio para saidas. Deve ser selecionado na lista cadastrada/liberada.'],
          ['Valor (R$)', 'Valor do movimento em dinheiro.', 'Obrigatorio quando houver linha de entrada ou saida.'],
          ['Repasse informado', 'Valor fisico entregue ao gestor ou caixa central.', 'Nao e saida. E transferencia do dinheiro excedente.'],
          ['Observacoes', 'Explicacao de ocorrencias, diferencas ou situacoes fora do padrao.', 'Obrigatorio quando houver divergencia critica. Recomendado sempre que algo fugir da rotina.'],
          ['Anexos', 'Comprovantes, recibos ou fotos.', 'Opcional, mas recomendado para saidas e ajustes.'],
        ],
      },
      {
        title: 'Calculos do sistema',
        body: '<div class="manual-formula">Saldo antes do repasse = Saldo inicial informado + Entradas - Saidas</div><div class="manual-formula">Saldo final = Saldo antes do repasse - Repasse informado</div><div class="manual-formula">Divergencia = Saldo final - Fundo padrao da loja</div><p>O ideal e a Divergencia ficar em 0,00 R$. Quando nao ficar, o sistema registra o valor para analise.</p>',
      },
      {
        title: 'Quando aparece divergencia',
        type: 'table',
        headers: ['Tipo', 'O que significa', 'Como tratar'],
        rows: [
          ['Divergencia de fundo positiva', 'Sobrou dinheiro alem do fundo padrao.', 'Verificar se faltou repasse ou se alguma entrada foi registrada incorretamente.'],
          ['Divergencia de fundo negativa', 'Faltou dinheiro para manter o fundo padrao.', 'Verificar contagem, saidas nao registradas ou retirada indevida.'],
          ['Divergencia de abertura', 'O Saldo inicial informado nao bate com o saldo final anterior.', 'Verificar troca de turno, retirada entre turnos ou erro no fechamento anterior.'],
        ],
      },
    ],
  },
  {
    key: 'relatorios',
    tab: 'Relatorios',
    title: 'Relatorios - como explicar para o cliente',
    lead: 'Os relatorios servem para transformar os fechamentos em conferencia financeira. Sempre confira filtros de Empresa, Loja e Periodo antes de exportar.',
    cards: [
      {
        title: 'Relatorios principais',
        type: 'table',
        headers: ['Relatorio', 'O que mostra', 'Como interpretar'],
        rows: [
          ['Fechamento por loja', 'Resumo dos fechamentos de uma loja no periodo.', 'Use para validar saldo inicial, entradas, saidas, repasse, saldo final e divergencia.'],
          ['Consolidado', 'Totais agrupados da operacao.', 'Use para visao mensal ou semanal por empresa/loja.'],
          ['Extrato', 'Cada entrada e saida registrada, com total de entradas e total de saidas.', 'Use quando o cliente quiser entender os movimentos que compoem o caixa.'],
          ['Repasses', 'Valores informados pelo operador e status de recebimento.', 'Use para saber o que ja foi confirmado, o que esta pendente e o que ficou com diferenca.'],
          ['Divergencias', 'Fechamentos com diferenca de fundo ou abertura.', 'Use para acompanhar pendencias e justificar ocorrencias.'],
          ['Modelo Conta Azul', 'Planilha ou envio para importacao/integracao no Conta Azul.', 'Use somente depois de revisar mapeamentos de Categoria, Cliente/Fornecedor, Conta Financeira e Centro de Custo.'],
        ],
      },
      {
        title: 'Filtros que precisam ser conferidos',
        body: '<ul class="manual-list"><li><strong>Empresa:</strong> define o cliente analisado.</li><li><strong>Loja:</strong> limita a conferencia a um caixa/loja especifico.</li><li><strong>Periodo:</strong> define datas inicial e final do relatorio.</li><li><strong>Status:</strong> ajuda a separar OK, Divergencia, Repasse pendente ou Confirmado.</li></ul>',
      },
      {
        title: 'Leitura recomendada para o analista',
        type: 'steps',
        items: [
          ['1. Comece pelo Consolidado', 'Veja se os totais do periodo fazem sentido.'],
          ['2. Abra o Extrato', 'Confira quais entradas e saidas formaram o total.'],
          ['3. Revise Repasses', 'Confirme se o dinheiro entregue foi confirmado pelo gestor.'],
          ['4. Feche em Divergencias', 'Explique ou direcione qualquer diferenca pendente.'],
        ],
      },
    ],
  },
  {
    key: 'contaazul',
    tab: 'Conta Azul',
    title: 'Conta Azul - sincronizacao, aprovacao e envio',
    lead: 'A integracao deve manter a mesma identificacao usada no Conta Azul. Por isso categorias, clientes, fornecedores, contas financeiras e centros de custo precisam vir da sincronizacao da empresa correta.',
    cards: [
      {
        title: 'Antes de enviar',
        type: 'table',
        headers: ['Item', 'Regra'],
        rows: [
          ['Empresa conectada', 'A empresa precisa estar conectada ao Conta Azul uma vez. Depois disso a conexao deve permanecer ativa enquanto o token puder ser renovado.'],
          ['Sincronizacao por empresa', 'Cada empresa deve sincronizar seus proprios Clientes, Fornecedores, Categorias, Contas Financeiras e Centros de Custo.'],
          ['Opcoes liberadas', 'Somente itens liberados pelo Master devem aparecer para operador/analista no fechamento.'],
          ['Conta Financeira Conta Azul', 'Obrigatoria antes do envio. Define em qual conta o lancamento sera criado.'],
          ['Centro de Custo Conta Azul', 'Vem do cadastro da loja. Se a loja tiver centro de custo, o sistema envia o centro vinculado. Se nao tiver, fica vazio.'],
          ['Previa para aprovacao', 'Os lancamentos devem ser revisados antes do envio. Apenas aprovados devem seguir para o Conta Azul.'],
          ['Pago/Recebido', 'Depois de criar o lancamento, o sistema baixa a parcela no Conta Azul usando a mesma data do lancamento.'],
        ],
      },
      {
        title: 'Campos enviados',
        type: 'table',
        headers: ['Campo no sistema', 'Uso no Conta Azul'],
        rows: [
          ['Data', 'Data do lancamento.'],
          ['Tipo', 'Entrada ou Saida.'],
          ['Descricao', 'Historico/descricao do lancamento.'],
          ['Categoria', 'Categoria financeira sincronizada e aprovada.'],
          ['Cliente/Fornecedor', 'Pessoa vinculada ao lancamento. Entrada usa Cliente; Saida usa Fornecedor.'],
          ['Valor (R$)', 'Valor do lancamento.'],
          ['Conta Financeira Conta Azul', 'Conta onde o lancamento sera registrado.'],
          ['Centro de Custo Conta Azul', 'Centro definido no cadastro da loja, quando aplicavel.'],
        ],
      },
      {
        title: 'Se o envio foi aprovado mas nao apareceu',
        body: '<ol class="manual-list"><li>Verifique se a empresa selecionada no sistema e a mesma empresa conectada no Conta Azul.</li><li>Confira a <strong>Conta Financeira Conta Azul</strong> escolhida na previa.</li><li>Confira se o periodo pesquisado no Conta Azul inclui a data do lancamento.</li><li>Verifique se houve erro retornado pela API no momento do envio.</li><li>Confirme se os IDs de Categoria e Cliente/Fornecedor vieram da sincronizacao correta da empresa.</li></ol>',
        tone: 'warning',
      },
    ],
  },
  {
    key: 'cadastros',
    tab: 'Cadastros',
    title: 'Cadastros - base da operacao',
    lead: 'A qualidade do fechamento depende dos cadastros. Um cadastro errado faz o operador selecionar informacao errada e pode gerar erro em relatorio ou Conta Azul.',
    cards: [
      {
        title: 'Empresa',
        type: 'table',
        headers: ['Campo', 'Uso'],
        rows: [
          ['Empresa / Razao social / CNPJ', 'Identificacao do cliente. Deve ficar correto para filtros e relatorios.'],
          ['Segmento / Plano / Status', 'Organizacao interna e acompanhamento de implantacao.'],
          ['Conectar Conta Azul', 'Acao restrita ao Master para conectar e sincronizar dados da empresa.'],
          ['Status de sincronizacao', 'Indica quando a empresa foi sincronizada e se existe pendencia.'],
        ],
      },
      {
        title: 'Loja / Caixa',
        type: 'table',
        headers: ['Campo', 'Uso'],
        rows: [
          ['Empresa', 'Define a qual cliente a loja pertence.'],
          ['Nome da loja', 'Nome exibido nos fechamentos e relatorios.'],
          ['Codigo', 'Identificacao curta da loja/caixa.'],
          ['Tipo de caixa', 'Caixa diario, caixa central ou caixa por turno.'],
          ['Fundo padrao', 'Valor que deve permanecer no caixa apos o repasse.'],
          ['Usar Centro de Custo Conta Azul', 'Quando marcado, exige selecionar o centro de custo sincronizado.'],
          ['Centro de Custo Conta Azul', 'Centro enviado nos lancamentos daquela loja.'],
          ['Status', 'Ativa, Implantacao, Pausada ou Inativa.'],
        ],
      },
      {
        title: 'Clientes, fornecedores e categorias',
        body: '<p>O ideal e sincronizar pelo Conta Azul e liberar apenas as opcoes que o operador pode usar. Isso reduz erro de digitacao e garante que o relatorio use a mesma identificacao do financeiro.</p>',
      },
    ],
  },
  {
    key: 'perfis',
    tab: 'Perfis',
    title: 'Perfis de acesso',
    lead: 'Cada perfil deve ver apenas o que precisa para executar sua funcao.',
    cards: [
      {
        title: 'Permissoes por perfil',
        type: 'table',
        headers: ['Perfil', 'Acesso esperado', 'Observacao'],
        rows: [
          ['Master', 'Todas as empresas, cadastros, sincronizacao, manutencao, logs, ajustes e relatorios.', 'Perfil interno da Gestao 5X.'],
          ['Analista', 'Empresas liberadas pelo Master, relatorios, fechamentos, conferencia e orientacao ao cliente.', 'Nao deve mexer em configuracoes sensiveis fora do escopo liberado.'],
          ['Admin Cliente', 'Empresa propria, lojas da empresa, historico, repasses, divergencias e relatorios liberados.', 'Responsavel por confirmar repasses e acompanhar operadores.'],
          ['Operador', 'Fechamento da propria loja e historico permitido.', 'Nao acessa outras lojas, empresas ou configuracoes.'],
        ],
      },
      {
        title: 'Regra pratica',
        body: '<p>Se a pessoa nao precisa executar a acao no dia a dia, nao libere o modulo. Menos opcoes reduzem erro operacional.</p>',
        tone: 'info',
      },
    ],
  },
  {
    key: 'gestor',
    tab: 'Gestor',
    title: 'Manual rapido do gestor',
    lead: 'O gestor acompanha a operacao da propria empresa e confirma o dinheiro recebido.',
    cards: [
      {
        title: 'Rotina diaria',
        type: 'steps',
        items: [
          ['1. Conferir fechamentos', 'Verifique se todas as lojas fecharam o caixa no dia.'],
          ['2. Confirmar repasses', 'Na aba Repasses, confirme o valor fisico recebido.'],
          ['3. Revisar divergencias', 'Leia Observacoes e Anexos. Se precisar, solicite retificacao.'],
          ['4. Acompanhar relatorios', 'Use Extrato e Consolidado para conferencia com o financeiro.'],
        ],
      },
      {
        title: 'Status de repasse',
        type: 'table',
        headers: ['Status', 'Significado'],
        rows: [
          ['Confirmado', 'Gestor confirmou recebimento do valor informado.'],
          ['Pendente', 'Operador informou repasse, mas o gestor ainda nao confirmou.'],
          ['Nao repassado', 'Havia valor sugerido para repasse, mas nada foi informado.'],
          ['Dentro da tolerancia', 'Valor pequeno aceito pela regra configurada.'],
          ['Diferenca aceita', 'Master encerrou a pendencia com justificativa registrada.'],
        ],
      },
    ],
  },
  {
    key: 'operador',
    tab: 'Operador',
    title: 'Manual rapido do operador',
    lead: 'O operador deve registrar o que aconteceu de verdade no caixa. O sistema calcula a conferencia.',
    cards: [
      {
        title: 'Passo a passo do fechamento',
        type: 'steps',
        items: [
          ['1. Conte o dinheiro', 'Digite o valor no campo Saldo inicial informado.'],
          ['2. Registre Entradas', 'Preencha Descricao, Categoria, Cliente e Valor (R$).'],
          ['3. Registre Saidas', 'Preencha Descricao da saida, Categoria, Fornecedor e Valor (R$).'],
          ['4. Confira Repasse sugerido', 'Informe em Repasse informado o valor que sera entregue.'],
          ['5. Explique diferencas', 'Se houver divergencia, use Observacoes e anexe comprovantes quando existir.'],
          ['6. Salve e entregue', 'Depois de salvar, entregue o dinheiro do repasse ao gestor.'],
        ],
      },
      {
        title: 'Erros comuns',
        type: 'table',
        headers: ['Erro', 'Como evitar'],
        rows: [
          ['Informar valor diferente do dinheiro contado', 'Conte duas vezes antes de salvar.'],
          ['Esquecer uma saida', 'Registre a retirada no momento em que acontecer.'],
          ['Escolher categoria errada', 'Use apenas a categoria que descreve o movimento real.'],
          ['Nao preencher Cliente/Fornecedor', 'Selecione sempre uma opcao da lista.'],
          ['Ajustar numero para zerar divergencia', 'Nunca faca isso. Registre o valor real e explique.'],
        ],
      },
    ],
  },
  {
    key: 'checklist',
    tab: 'Checklist',
    title: 'Checklist de implantacao e acompanhamento',
    lead: 'Use este checklist para garantir que a operacao esta pronta antes de liberar o cliente.',
    cards: [
      {
        title: 'Antes de ativar uma empresa',
        type: 'checklist',
        items: [
          'Empresa cadastrada com dados corretos.',
          'Todas as lojas cadastradas com Fundo padrao correto.',
          'Centro de Custo Conta Azul definido nas lojas que usam centro de custo.',
          'Usuarios Admin e Operador criados e vinculados corretamente.',
          'Categorias, Clientes e Fornecedores sincronizados ou cadastrados.',
          'Opcoes liberadas para aparecerem no fechamento.',
          'Conta Financeira Conta Azul sincronizada e validada.',
          'Fechamento teste realizado com operador.',
          'Gestor treinado para confirmar repasses.',
        ],
      },
      {
        title: 'Acompanhamento semanal',
        type: 'checklist',
        items: [
          'Verificar lojas sem fechamento recente.',
          'Revisar divergencias abertas.',
          'Conferir repasses pendentes.',
          'Exportar relatorio consolidado quando solicitado.',
          'Sincronizar Conta Azul apenas quando houver necessidade de atualizar cadastros.',
        ],
      },
    ],
  },
];

function manualCard5x(card) {
  const toneClass = card.tone ? ` manual-card-${card.tone}` : '';
  let body = card.body || '';

  if (card.type === 'table') {
    body = `<div class="table-wrap manual-table-wrap"><table class="table"><thead><tr>${card.headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${card.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  if (card.type === 'steps') {
    body = `<div class="manual-steps">${card.items.map(([label, text]) => `<div class="manual-step"><strong>${label}</strong><span>${text}</span></div>`).join('')}</div>`;
  }

  if (card.type === 'checklist') {
    body = `<ul class="manual-checklist">${card.items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
  }

  return `<article class="card manual-card${toneClass}"><h3 class="section-title">${card.title}</h3>${body}</article>`;
}

function renderManual5x() {
  const root = document.getElementById('manualImplantacao');
  if (!root) return;

  root.innerHTML = `
    <div class="card manual-hero">
      <div>
        <span class="manual-kicker">Manual 5X</span>
        <h3 class="section-title">Guia operacional do Fechamento de Caixa</h3>
        <p class="subtle">Manual organizado para Gestao 5X, analistas, gestores e operadores. Explica os campos reais do sistema, os relatorios e a integracao com Conta Azul.</p>
      </div>
      <div class="btn-row manual-actions">
        <button class="btn btn-primary" onclick="exportManualPDF()">Exportar tudo</button>
        <button class="btn btn-secondary" onclick="exportManualTabPDF()">Exportar aba atual</button>
      </div>
    </div>

    <div class="inner-tabs manual-tabs">
      ${manualSections5x.map((section, index) => `<button class="inner-tab-btn ${index === 0 ? 'active' : ''}" data-subtab="man-${section.key}" onclick="showSubTab('manualImplantacao','man-${section.key}',this)">${section.tab}</button>`).join('')}
    </div>

    ${manualSections5x.map((section, index) => `
      <div id="man-${section.key}" class="inner-tab-panel ${index === 0 ? '' : 'hidden'}">
        <div class="manual-section-head">
          <h2>${section.title}</h2>
          <p>${section.lead}</p>
        </div>
        <div class="manual-grid">
          ${section.cards.map(manualCard5x).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

function manualPlainText5x(value) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(value || '');
  return tmp.textContent || tmp.innerText || '';
}

async function exportManualPDF(onlySection = null) {
  if (!window.jspdf) {
    alert('jsPDF nao carregado. Aguarde a pagina carregar completamente.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const dark = [13, 23, 32];
  const teal = [54, 199, 189];
  const sections = onlySection ? manualSections5x.filter((section) => section.key === onlySection) : manualSections5x;

  if (!sections.length) {
    alert('Secao nao encontrada.');
    return;
  }

  const footer = () => {
    const n = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(130, 145, 160);
    doc.text(`Pagina ${n} - Manual 5X - ${new Date().toLocaleDateString('pt-BR')}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
  };

  let hasRenderedPage = false;
  const newPage = (title) => {
    if (hasRenderedPage) doc.addPage();
    hasRenderedPage = true;
    doc.setFillColor(...dark);
    doc.rect(0, 0, pageWidth, 20, 'F');
    doc.setFillColor(...teal);
    doc.rect(0, 20, pageWidth, 1.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text(title, pageWidth / 2, 13, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    return 32;
  };

  let y = newPage(onlySection ? sections[0].title : 'Manual 5X - Guia operacional do Fechamento de Caixa');
  if (!onlySection) {
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('Manual 5X', pageWidth / 2, 62, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 90, 105);
    doc.text('Guia operacional para Gestao 5X, analistas, gestores e operadores.', pageWidth / 2, 72, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    y = 92;
    doc.autoTable({
      startY: y,
      head: [['Secao', 'Conteudo']],
      body: manualSections5x.map((section) => [section.tab, section.title]),
      theme: 'grid',
      headStyles: { fillColor: dark, textColor: [255, 255, 255] },
      bodyStyles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    footer();
  }

  sections.forEach((section, index) => {
    if (!onlySection || index > 0) y = newPage(section.title);
    doc.setFontSize(10);
    doc.setTextColor(70, 80, 95);
    doc.text(doc.splitTextToSize(section.lead, pageWidth - margin * 2), margin, y);
    y += 16;
    doc.setTextColor(0, 0, 0);

    section.cards.forEach((card) => {
      if (y > 245) y = newPage(section.title);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(card.title, margin, y);
      doc.setFont(undefined, 'normal');
      y += 6;

      if (card.type === 'table') {
        doc.autoTable({
          startY: y,
          head: [card.headers],
          body: card.rows.map((row) => row.map(manualPlainText5x)),
          theme: 'grid',
          headStyles: { fillColor: dark, textColor: [255, 255, 255], fontSize: 8 },
          bodyStyles: { fontSize: 8, cellPadding: 2 },
          margin: { left: margin, right: margin },
          styles: { overflow: 'linebreak' },
        });
        y = doc.lastAutoTable.finalY + 8;
      } else {
        const lines = card.type === 'steps'
          ? card.items.map(([label, text]) => `${label}: ${text}`)
          : card.type === 'checklist'
            ? card.items.map((item) => `[ ] ${item}`)
            : [manualPlainText5x(card.body)];

        doc.setFontSize(9);
        lines.forEach((line) => {
          const wrapped = doc.splitTextToSize(line, pageWidth - margin * 2);
          if (y + wrapped.length * 5 > 270) y = newPage(section.title);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 5 + 3;
        });
        y += 3;
      }
    });
    footer();
  });

  const name = onlySection ? `manual_${onlySection}_gestao5x.pdf` : 'manual_5x_gestao_operacional.pdf';
  doc.save(name);
}

async function exportManualTabPDF() {
  const btn = document.querySelector('#manualImplantacao .inner-tab-btn.active');
  const tabId = btn?.dataset?.subtab || 'man-overview';
  await exportManualPDF(tabId.replace('man-', ''));
}

document.addEventListener('DOMContentLoaded', renderManual5x);

Object.assign(window, {
  renderManual5x,
  exportManualPDF,
  exportManualTabPDF,
});

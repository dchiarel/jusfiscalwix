/**
 * Geração de arquivo texto para integração com sistema de gestão (ERP)
 * Formato delimitado por pipe | com header e footer
 */
const { getDb } = require('../database/db');
const path = require('path');
const fs = require('fs');

function pad(str, len, char = ' ') {
  return String(str || '').substring(0, len).padEnd(len, char);
}

function formatarDataArquivo(iso) {
  if (!iso) return '        ';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function gerarArquivoContribuintes(filtros = {}) {
  const db = getDb();
  let where = '1=1';
  const params = [];

  if (filtros.situacao) {
    where += ' AND situacao = ?';
    params.push(filtros.situacao);
  }
  if (filtros.dataInicio) {
    where += ' AND updated_at >= ?';
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where += ' AND updated_at <= ?';
    params.push(filtros.dataFim + ' 23:59:59');
  }

  const contribuintes = db.prepare(`SELECT * FROM contribuintes WHERE ${where} ORDER BY razao_social`).all(...params);

  const now = new Date();
  const header = [
    'TIPO',
    'DOCUMENTO',
    'RAZAO_SOCIAL',
    'NOME_FANTASIA',
    'ENDERECO',
    'NUMERO',
    'COMPLEMENTO',
    'BAIRRO',
    'CIDADE',
    'UF',
    'CEP',
    'TELEFONE',
    'EMAIL',
    'CAPITAL_SOCIAL',
    'NUM_EMPREGADOS',
    'FOLHA_PAGAMENTO',
    'ATIVIDADE',
    'DATA_ABERTURA',
    'SITUACAO',
    'ATUALIZADO_EM',
  ].join('|');

  const linhas = contribuintes.map(c =>
    [
      c.tipo,
      c.documento,
      c.razao_social,
      c.nome_fantasia || '',
      c.endereco || '',
      c.numero || '',
      c.complemento || '',
      c.bairro || '',
      c.cidade || '',
      c.uf || '',
      c.cep || '',
      c.telefone || '',
      c.email || '',
      (c.capital_social || 0).toFixed(2),
      c.num_empregados || 0,
      (c.folha_pagamento || 0).toFixed(2),
      c.atividade_economica || '',
      c.data_abertura || '',
      c.situacao,
      c.updated_at || '',
    ].join('|')
  );

  const rodape = `##TOTAL|${contribuintes.length}|${now.toISOString()}`;
  const conteudo = [header, ...linhas, rodape].join('\n');

  const nomeArquivo = `contribuintes_${now.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.txt`;
  const dirExport = path.join(__dirname, '..', 'public', 'uploads', 'exportacoes');
  if (!fs.existsSync(dirExport)) fs.mkdirSync(dirExport, { recursive: true });

  const filePath = path.join(dirExport, nomeArquivo);
  fs.writeFileSync(filePath, conteudo, 'utf8');

  db.prepare(`
    INSERT INTO exportacoes (tipo, nome_arquivo, total_registros, filtro_inicio, filtro_fim)
    VALUES ('contribuintes', ?, ?, ?, ?)
  `).run(nomeArquivo, contribuintes.length, filtros.dataInicio || null, filtros.dataFim || null);

  return { nomeArquivo, filePath, totalRegistros: contribuintes.length, conteudo };
}

function gerarArquivoGuias(filtros = {}) {
  const db = getDb();
  let where = '1=1';
  const params = [];

  if (filtros.status) {
    where += ' AND g.status = ?';
    params.push(filtros.status);
  }
  if (filtros.dataInicio) {
    where += ' AND g.vencimento >= ?';
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where += ' AND g.vencimento <= ?';
    params.push(filtros.dataFim);
  }
  if (filtros.competencia) {
    where += ' AND g.competencia = ?';
    params.push(filtros.competencia);
  }

  const guias = db.prepare(`
    SELECT g.*, c.documento, c.razao_social, c.tipo as contrib_tipo
    FROM guias g
    JOIN contribuintes c ON c.id = g.contribuinte_id
    WHERE ${where}
    ORDER BY g.vencimento, g.numero
  `).all(...params);

  const now = new Date();
  const header = [
    'NUMERO_GUIA',
    'TIPO_CONTRIB',
    'DOCUMENTO',
    'RAZAO_SOCIAL',
    'COMPETENCIA',
    'VENCIMENTO',
    'VALOR_PRINCIPAL',
    'VALOR_MULTA',
    'VALOR_JUROS',
    'VALOR_TOTAL',
    'STATUS',
    'DATA_PAGAMENTO',
    'VALOR_PAGO',
    'NOSSO_NUMERO',
    'EMITIDA_EM',
  ].join('|');

  const linhas = guias.map(g =>
    [
      g.numero,
      g.contrib_tipo,
      g.documento,
      g.razao_social,
      g.competencia,
      g.vencimento,
      g.valor_principal.toFixed(2),
      g.valor_multa.toFixed(2),
      g.valor_juros.toFixed(2),
      g.valor_total.toFixed(2),
      g.status,
      g.data_pagamento || '',
      g.valor_pago ? g.valor_pago.toFixed(2) : '',
      g.nosso_numero || '',
      g.created_at,
    ].join('|')
  );

  const totalPago = guias
    .filter(g => g.status === 'paga')
    .reduce((sum, g) => sum + (g.valor_pago || 0), 0);

  const rodape = `##TOTAL|${guias.length}|TOTAL_PAGO:${totalPago.toFixed(2)}|${now.toISOString()}`;
  const conteudo = [header, ...linhas, rodape].join('\n');

  const nomeArquivo = `guias_${now.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.txt`;
  const dirExport = path.join(__dirname, '..', 'public', 'uploads', 'exportacoes');
  if (!fs.existsSync(dirExport)) fs.mkdirSync(dirExport, { recursive: true });

  const filePath = path.join(dirExport, nomeArquivo);
  fs.writeFileSync(filePath, conteudo, 'utf8');

  db.prepare(`
    INSERT INTO exportacoes (tipo, nome_arquivo, total_registros, filtro_inicio, filtro_fim)
    VALUES ('guias', ?, ?, ?, ?)
  `).run(nomeArquivo, guias.length, filtros.dataInicio || null, filtros.dataFim || null);

  return { nomeArquivo, filePath, totalRegistros: guias.length, conteudo };
}

module.exports = { gerarArquivoContribuintes, gerarArquivoGuias };

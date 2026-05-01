/**
 * Processamento de arquivo de retorno bancário (CNAB 240 / CNAB 400)
 * Suporte a padrão Febraban / Bradesco / Itaú / BB
 */
const { getDb } = require('../database/db');

function detectarFormato(linhas) {
  const primeiraLinha = linhas[0] || '';
  if (primeiraLinha.length >= 240) return 'CNAB240';
  if (primeiraLinha.length >= 400) return 'CNAB400';
  return 'CNAB400';
}

function parseCNAB400(linhas) {
  const registros = [];
  for (const linha of linhas) {
    if (!linha || linha.trim() === '') continue;
    const tipoReg = linha.substring(0, 1);
    if (tipoReg !== '1') continue; // só detalhe

    const codOcorrencia = linha.substring(108, 110).trim();
    // 06 = liquidado, 02 = entrada confirmada, 15 = liquidação em cartório
    const liquidados = ['06', '15', '17'];
    if (!liquidados.includes(codOcorrencia)) continue;

    const nossoNumero = linha.substring(70, 80).trim().replace(/^0+/, '');
    const dataOcorrencia = linha.substring(110, 116).trim();
    const valorPago = parseInt(linha.substring(253, 265).trim(), 10) / 100;

    const [dd, mm, aa] = [
      dataOcorrencia.substring(0, 2),
      dataOcorrencia.substring(2, 4),
      dataOcorrencia.substring(4, 6),
    ];
    const dataFormatada = `20${aa}-${mm}-${dd}`;

    registros.push({ nossoNumero, dataPagamento: dataFormatada, valorPago });
  }
  return registros;
}

function parseCNAB240(linhas) {
  const registros = [];
  for (const linha of linhas) {
    if (!linha || linha.trim() === '') continue;
    const segmento = linha.substring(13, 14);
    if (segmento !== 'T') continue;

    const codOcorrencia = linha.substring(15, 17).trim();
    const liquidados = ['06', '15', '17'];
    if (!liquidados.includes(codOcorrencia)) continue;

    const nossoNumero = linha.substring(105, 125).trim().replace(/^0+/, '');
    const dataPagamento = linha.substring(145, 153).trim();
    const valorPago = parseInt(linha.substring(153, 168).trim(), 10) / 100;

    const [dd, mm, aaaa] = [
      dataPagamento.substring(0, 2),
      dataPagamento.substring(2, 4),
      dataPagamento.substring(4, 8),
    ];
    const dataFormatada = `${aaaa}-${mm}-${dd}`;

    registros.push({ nossoNumero, dataPagamento: dataFormatada, valorPago });
  }
  return registros;
}

function processarRetorno(conteudo, nomeArquivo) {
  const db = getDb();
  const linhas = conteudo.split('\n').map(l => l.replace(/\r/, ''));
  const formato = detectarFormato(linhas);
  const registros = formato === 'CNAB240' ? parseCNAB240(linhas) : parseCNAB400(linhas);

  const retorno = db.prepare(`
    INSERT INTO retornos_bancarios (nome_arquivo, total_registros)
    VALUES (?, ?)
  `).run(nomeArquivo, registros.length);

  const retornoId = retorno.lastInsertRowid;
  let baixados = 0;
  let erros = 0;
  const detalhes = [];

  for (const reg of registros) {
    const guia = db.prepare(
      'SELECT * FROM guias WHERE nosso_numero = ? AND status != ?'
    ).get(reg.nossoNumero, 'paga');

    if (!guia) {
      db.prepare(`
        INSERT INTO retorno_registros (retorno_id, nosso_numero, valor_pago, data_pagamento, status_processamento, mensagem)
        VALUES (?, ?, ?, ?, 'nao_encontrado', 'Guia não localizada ou já paga')
      `).run(retornoId, reg.nossoNumero, reg.valorPago, reg.dataPagamento);
      erros++;
      detalhes.push({ ...reg, status: 'nao_encontrado' });
      continue;
    }

    db.prepare(`
      UPDATE guias SET status = 'paga', data_pagamento = ?, valor_pago = ?,
      updated_at = datetime('now','localtime') WHERE id = ?
    `).run(reg.dataPagamento, reg.valorPago, guia.id);

    db.prepare(`
      INSERT INTO retorno_registros (retorno_id, guia_id, nosso_numero, valor_pago, data_pagamento, status_processamento, mensagem)
      VALUES (?, ?, ?, ?, ?, 'baixado', 'Guia baixada com sucesso')
    `).run(retornoId, guia.id, reg.nossoNumero, reg.valorPago, reg.dataPagamento);

    baixados++;
    detalhes.push({ ...reg, guiaNumero: guia.numero, status: 'baixado' });
  }

  db.prepare(`
    UPDATE retornos_bancarios SET registros_baixados = ?, registros_erro = ?,
    conteudo_resumo = ? WHERE id = ?
  `).run(baixados, erros, JSON.stringify(detalhes.slice(0, 50)), retornoId);

  return {
    retornoId,
    formato,
    totalRegistros: registros.length,
    baixados,
    erros,
    detalhes,
  };
}

module.exports = { processarRetorno };

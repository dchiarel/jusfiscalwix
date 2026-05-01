const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { calcularEncargos, calcularValorContribuicao, gerarNumeroGuia, calcularVencimento } = require('../services/calculadora');
const { gerarPDFGuia } = require('../services/pdf');

// Buscar contribuinte por CNPJ/CPF (sem senha)
router.get('/contribuinte/:documento', (req, res) => {
  const db = getDb();
  const doc = req.params.documento.replace(/\D/g, '');
  const contribuinte = db.prepare(
    'SELECT * FROM contribuintes WHERE documento = ?'
  ).get(doc);

  if (!contribuinte) {
    return res.json({ found: false });
  }

  // Não retorna dados sensíveis internos, apenas para exibição
  res.json({
    found: true,
    contribuinte: {
      id: contribuinte.id,
      tipo: contribuinte.tipo,
      documento: contribuinte.documento,
      razao_social: contribuinte.razao_social,
      nome_fantasia: contribuinte.nome_fantasia,
      endereco: contribuinte.endereco,
      numero: contribuinte.numero,
      complemento: contribuinte.complemento,
      bairro: contribuinte.bairro,
      cidade: contribuinte.cidade,
      uf: contribuinte.uf,
      cep: contribuinte.cep,
      telefone: contribuinte.telefone,
      email: contribuinte.email,
      capital_social: contribuinte.capital_social,
      num_empregados: contribuinte.num_empregados,
      folha_pagamento: contribuinte.folha_pagamento,
      situacao: contribuinte.situacao,
    },
  });
});

// Calcular prévia de guia (sem salvar)
router.post('/calcular', (req, res) => {
  const { documento, competencia } = req.body;
  const db = getDb();
  const doc = (documento || '').replace(/\D/g, '');

  if (!doc || !competencia) {
    return res.status(400).json({ error: 'Documento e competência são obrigatórios' });
  }

  const contribuinte = db.prepare('SELECT * FROM contribuintes WHERE documento = ?').get(doc);

  let valorPrincipal = 0;
  let historico = '';

  if (contribuinte) {
    const calc = calcularValorContribuicao(contribuinte, competencia);
    valorPrincipal = calc.valor;
    historico = calc.historico;
  } else {
    return res.status(404).json({ error: 'Contribuinte não cadastrado. Cadastre-se primeiro.' });
  }

  const vencimento = calcularVencimento(competencia);
  const { multa, juros, diasAtraso } = calcularEncargos(valorPrincipal, vencimento);
  const total = valorPrincipal + multa + juros;

  res.json({
    valorPrincipal,
    valorMulta: multa,
    valorJuros: juros,
    valorTotal: total,
    vencimento,
    diasAtraso,
    historico,
  });
});

// Emitir guia
router.post('/emitir', (req, res) => {
  const db = getDb();
  const { documento, competencia, dadosContribuinte } = req.body;
  const doc = (documento || '').replace(/\D/g, '');

  if (!doc || !competencia) {
    return res.status(400).json({ error: 'Documento e competência são obrigatórios' });
  }

  // Verificar se já existe guia para esse contribuinte/competência
  let contribuinte = db.prepare('SELECT * FROM contribuintes WHERE documento = ?').get(doc);

  if (!contribuinte) {
    // Auto-cadastro na emissão
    if (!dadosContribuinte || !dadosContribuinte.razao_social) {
      return res.status(400).json({ error: 'Contribuinte não encontrado. Informe os dados para cadastro.' });
    }
    const tipo = doc.length === 14 ? 'PJ' : 'PF';
    const insert = db.prepare(`
      INSERT INTO contribuintes (tipo, documento, razao_social, nome_fantasia, endereco, numero,
        complemento, bairro, cidade, uf, cep, telefone, email, capital_social, num_empregados, folha_pagamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tipo, doc,
      dadosContribuinte.razao_social,
      dadosContribuinte.nome_fantasia || '',
      dadosContribuinte.endereco || '',
      dadosContribuinte.numero || '',
      dadosContribuinte.complemento || '',
      dadosContribuinte.bairro || '',
      dadosContribuinte.cidade || '',
      dadosContribuinte.uf || '',
      dadosContribuinte.cep || '',
      dadosContribuinte.telefone || '',
      dadosContribuinte.email || '',
      parseFloat(dadosContribuinte.capital_social) || 0,
      parseInt(dadosContribuinte.num_empregados) || 0,
      parseFloat(dadosContribuinte.folha_pagamento) || 0,
    );
    contribuinte = db.prepare('SELECT * FROM contribuintes WHERE id = ?').get(insert.lastInsertRowid);
  } else if (dadosContribuinte) {
    // Atualizar cadastro se enviou novos dados
    db.prepare(`
      UPDATE contribuintes SET
        razao_social = COALESCE(?, razao_social),
        nome_fantasia = COALESCE(?, nome_fantasia),
        endereco = COALESCE(?, endereco),
        numero = COALESCE(?, numero),
        complemento = COALESCE(?, complemento),
        bairro = COALESCE(?, bairro),
        cidade = COALESCE(?, cidade),
        uf = COALESCE(?, uf),
        cep = COALESCE(?, cep),
        telefone = COALESCE(?, telefone),
        email = COALESCE(?, email),
        capital_social = COALESCE(?, capital_social),
        num_empregados = COALESCE(?, num_empregados),
        folha_pagamento = COALESCE(?, folha_pagamento),
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      dadosContribuinte.razao_social || null,
      dadosContribuinte.nome_fantasia || null,
      dadosContribuinte.endereco || null,
      dadosContribuinte.numero || null,
      dadosContribuinte.complemento || null,
      dadosContribuinte.bairro || null,
      dadosContribuinte.cidade || null,
      dadosContribuinte.uf || null,
      dadosContribuinte.cep || null,
      dadosContribuinte.telefone || null,
      dadosContribuinte.email || null,
      dadosContribuinte.capital_social != null ? parseFloat(dadosContribuinte.capital_social) : null,
      dadosContribuinte.num_empregados != null ? parseInt(dadosContribuinte.num_empregados) : null,
      dadosContribuinte.folha_pagamento != null ? parseFloat(dadosContribuinte.folha_pagamento) : null,
      contribuinte.id,
    );
    contribuinte = db.prepare('SELECT * FROM contribuintes WHERE id = ?').get(contribuinte.id);
  }

  // Verificar duplicidade
  const existente = db.prepare(
    "SELECT * FROM guias WHERE contribuinte_id = ? AND competencia = ? AND status != 'cancelada'"
  ).get(contribuinte.id, competencia);

  if (existente) {
    return res.json({ guia: existente, jaExistia: true });
  }

  const { valor: valorPrincipal, historico } = calcularValorContribuicao(contribuinte, competencia);
  const vencimento = calcularVencimento(competencia);
  const { multa, juros } = calcularEncargos(valorPrincipal, vencimento);
  const valorTotal = valorPrincipal + multa + juros;
  const numero = gerarNumeroGuia();

  const guiaInsert = db.prepare(`
    INSERT INTO guias (numero, contribuinte_id, competencia, valor_principal, valor_multa, valor_juros,
      valor_total, vencimento, status, historico_calculo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?)
  `).run(numero, contribuinte.id, competencia, valorPrincipal, multa, juros, valorTotal, vencimento, historico);

  const guia = db.prepare('SELECT * FROM guias WHERE id = ?').get(guiaInsert.lastInsertRowid);

  res.json({ guia, jaExistia: false });
});

// Consultar guias de um contribuinte por CNPJ/CPF
router.get('/consultar/:documento', (req, res) => {
  const db = getDb();
  const doc = req.params.documento.replace(/\D/g, '');

  const contribuinte = db.prepare('SELECT * FROM contribuintes WHERE documento = ?').get(doc);
  if (!contribuinte) {
    return res.json({ found: false, guias: [] });
  }

  const guias = db.prepare(`
    SELECT * FROM guias WHERE contribuinte_id = ? ORDER BY vencimento DESC
  `).all(contribuinte.id);

  // Atualizar status das guias vencidas
  const hoje = new Date().toISOString().split('T')[0];
  for (const g of guias) {
    if (g.status === 'aberta' && g.vencimento < hoje) {
      db.prepare("UPDATE guias SET status = 'vencida', updated_at = datetime('now','localtime') WHERE id = ?").run(g.id);
      g.status = 'vencida';
      const { multa, juros } = calcularEncargos(g.valor_principal, g.vencimento);
      g.valor_multa = multa;
      g.valor_juros = juros;
      g.valor_total = g.valor_principal + multa + juros;
    }
  }

  res.json({ found: true, contribuinte, guias });
});

// Gerar PDF de uma guia
router.get('/:id/pdf', async (req, res) => {
  try {
    await gerarPDFGuia(parseInt(req.params.id), res);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Detalhes de uma guia por número
router.get('/numero/:numero', (req, res) => {
  const db = getDb();
  const guia = db.prepare(`
    SELECT g.*, c.razao_social, c.documento, c.tipo, c.cidade, c.uf
    FROM guias g JOIN contribuintes c ON c.id = g.contribuinte_id
    WHERE g.numero = ?
  `).get(req.params.numero);

  if (!guia) return res.status(404).json({ error: 'Guia não encontrada' });
  res.json(guia);
});

module.exports = router;

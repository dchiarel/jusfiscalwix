const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');
const { processarRetorno } = require('../services/retorno');
const { gerarArquivoContribuintes, gerarArquivoGuias } = require('../services/exportacao');
const { calcularEncargos } = require('../services/calculadora');

// Middleware simples de autenticação por header
function authAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== (process.env.ADMIN_SECRET || 'sindical-admin-2024')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

// === ENTIDADE ===
router.get('/entidade', authAdmin, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM entidade WHERE id = 1').get());
});

router.put('/entidade', authAdmin, (req, res) => {
  const db = getDb();
  const campos = [
    'razao_social', 'cnpj', 'endereco', 'telefone', 'email', 'site',
    'cor_primaria', 'cor_secundaria', 'cor_texto_header',
    'rodape_texto', 'conta_banco', 'agencia', 'conta_corrente',
    'cedente_nome', 'cedente_cnpj', 'codigo_banco', 'instrucoes_boleto',
  ];
  const sets = campos.map(c => `${c} = @${c}`).join(', ');
  const data = {};
  for (const c of campos) data[c] = req.body[c] ?? null;

  db.prepare(`UPDATE entidade SET ${sets}, updated_at = datetime('now','localtime') WHERE id = 1`).run(data);
  res.json({ ok: true });
});

// Upload de logo
router.post('/entidade/logo', authAdmin, (req, res) => {
  if (!req.files || !req.files.logo) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  const logoDir = path.join(__dirname, '..', 'public', 'uploads', 'logo');
  if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

  const ext = path.extname(req.files.logo.name).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
    return res.status(400).json({ error: 'Formato de imagem inválido' });
  }
  const nomeArq = `logo${ext}`;
  const destino = path.join(logoDir, nomeArq);
  req.files.logo.mv(destino, err => {
    if (err) return res.status(500).json({ error: 'Erro ao salvar logo' });
    const db = getDb();
    db.prepare("UPDATE entidade SET logo_path = ? WHERE id = 1").run(`/uploads/logo/${nomeArq}`);
    res.json({ ok: true, path: `/uploads/logo/${nomeArq}` });
  });
});

// === TABELA DE CÁLCULO ===
router.get('/tabela-calculo', authAdmin, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM tabela_calculo ORDER BY faixa_min ASC').all());
});

router.post('/tabela-calculo', authAdmin, (req, res) => {
  const db = getDb();
  const { tipo, descricao, base_calculo, percentual, valor_fixo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio, vigencia_fim } = req.body;
  const result = db.prepare(`
    INSERT INTO tabela_calculo (tipo, descricao, base_calculo, percentual, valor_fixo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio, vigencia_fim)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tipo, descricao, base_calculo, percentual, valor_fixo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio, vigencia_fim);
  res.json({ id: result.lastInsertRowid });
});

router.put('/tabela-calculo/:id', authAdmin, (req, res) => {
  const db = getDb();
  const { tipo, descricao, base_calculo, percentual, valor_fixo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio, vigencia_fim, ativo } = req.body;
  db.prepare(`
    UPDATE tabela_calculo SET tipo=?, descricao=?, base_calculo=?, percentual=?, valor_fixo=?,
    faixa_min=?, faixa_max=?, valor_resultado=?, referencia=?, vigencia_inicio=?, vigencia_fim=?, ativo=?
    WHERE id=?
  `).run(tipo, descricao, base_calculo, percentual, valor_fixo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio, vigencia_fim, ativo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/tabela-calculo/:id', authAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM tabela_calculo WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// === ENCARGOS ===
router.get('/encargos', authAdmin, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM config_encargos WHERE id = 1').get());
});

router.put('/encargos', authAdmin, (req, res) => {
  const db = getDb();
  const { multa_percentual, juros_ao_mes, dias_carencia } = req.body;
  db.prepare(`
    UPDATE config_encargos SET multa_percentual=?, juros_ao_mes=?, dias_carencia=?,
    updated_at=datetime('now','localtime') WHERE id=1
  `).run(multa_percentual, juros_ao_mes, dias_carencia);
  res.json({ ok: true });
});

// === CONTRIBUINTES ===
router.get('/contribuintes', authAdmin, (req, res) => {
  const db = getDb();
  const { busca, situacao, page = 1, limit = 50 } = req.query;
  let where = '1=1';
  const params = [];
  if (busca) {
    where += ' AND (razao_social LIKE ? OR documento LIKE ? OR nome_fantasia LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  if (situacao) { where += ' AND situacao = ?'; params.push(situacao); }

  const total = db.prepare(`SELECT COUNT(*) as n FROM contribuintes WHERE ${where}`).get(...params).n;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const dados = db.prepare(`SELECT * FROM contribuintes WHERE ${where} ORDER BY razao_social LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, dados });
});

router.post('/contribuintes', authAdmin, (req, res) => {
  const db = getDb();
  const c = req.body;
  const tipo = (c.documento || '').replace(/\D/g, '').length === 14 ? 'PJ' : 'PF';
  try {
    const r = db.prepare(`
      INSERT INTO contribuintes (tipo, documento, razao_social, nome_fantasia, endereco, numero,
        complemento, bairro, cidade, uf, cep, telefone, email, capital_social, num_empregados,
        folha_pagamento, atividade_economica, data_abertura, situacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, (c.documento||'').replace(/\D/g,''), c.razao_social, c.nome_fantasia||'',
      c.endereco||'', c.numero||'', c.complemento||'', c.bairro||'', c.cidade||'', c.uf||'',
      c.cep||'', c.telefone||'', c.email||'', parseFloat(c.capital_social)||0,
      parseInt(c.num_empregados)||0, parseFloat(c.folha_pagamento)||0,
      c.atividade_economica||'', c.data_abertura||'', c.situacao||'ativo');
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'CNPJ/CPF já cadastrado' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/contribuintes/:id', authAdmin, (req, res) => {
  const db = getDb();
  const c = req.body;
  db.prepare(`
    UPDATE contribuintes SET razao_social=?, nome_fantasia=?, endereco=?, numero=?, complemento=?,
    bairro=?, cidade=?, uf=?, cep=?, telefone=?, email=?, capital_social=?, num_empregados=?,
    folha_pagamento=?, atividade_economica=?, data_abertura=?, situacao=?,
    updated_at=datetime('now','localtime') WHERE id=?
  `).run(c.razao_social, c.nome_fantasia||'', c.endereco||'', c.numero||'', c.complemento||'',
    c.bairro||'', c.cidade||'', c.uf||'', c.cep||'', c.telefone||'', c.email||'',
    parseFloat(c.capital_social)||0, parseInt(c.num_empregados)||0, parseFloat(c.folha_pagamento)||0,
    c.atividade_economica||'', c.data_abertura||'', c.situacao||'ativo', req.params.id);
  res.json({ ok: true });
});

// === GUIAS ===
router.get('/guias', authAdmin, (req, res) => {
  const db = getDb();
  const { status, competencia, documento, page = 1, limit = 50 } = req.query;
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND g.status = ?'; params.push(status); }
  if (competencia) { where += ' AND g.competencia = ?'; params.push(competencia); }
  if (documento) {
    where += ' AND c.documento LIKE ?';
    params.push(`%${documento.replace(/\D/g, '')}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM guias g JOIN contribuintes c ON c.id=g.contribuinte_id WHERE ${where}`).get(...params).n;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const dados = db.prepare(`
    SELECT g.*, c.razao_social, c.documento FROM guias g
    JOIN contribuintes c ON c.id = g.contribuinte_id
    WHERE ${where} ORDER BY g.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ total, dados });
});

router.put('/guias/:id', authAdmin, (req, res) => {
  const db = getDb();
  const { status, data_pagamento, valor_pago, observacoes } = req.body;
  db.prepare(`
    UPDATE guias SET status=?, data_pagamento=?, valor_pago=?, observacoes=?,
    updated_at=datetime('now','localtime') WHERE id=?
  `).run(status, data_pagamento||null, valor_pago||null, observacoes||null, req.params.id);
  res.json({ ok: true });
});

router.delete('/guias/:id', authAdmin, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE guias SET status='cancelada', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// === RELATÓRIOS ===
router.get('/relatorio/resumo', authAdmin, (req, res) => {
  const db = getDb();
  const totalContribuintes = db.prepare("SELECT COUNT(*) as n FROM contribuintes WHERE situacao='ativo'").get().n;
  const guiasPorStatus = db.prepare("SELECT status, COUNT(*) as qtd, SUM(valor_total) as total FROM guias GROUP BY status").all();
  const totalArrecadado = db.prepare("SELECT SUM(valor_pago) as total FROM guias WHERE status='paga'").get().total || 0;
  const guiasVencidas = db.prepare("SELECT COUNT(*) as n, SUM(valor_total) as total FROM guias WHERE status='vencida'").get();

  res.json({ totalContribuintes, guiasPorStatus, totalArrecadado, guiasVencidas });
});

// === RETORNO BANCÁRIO ===
router.post('/retorno', authAdmin, (req, res) => {
  if (!req.files || !req.files.arquivo) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  try {
    const conteudo = req.files.arquivo.data.toString('latin1');
    const resultado = processarRetorno(conteudo, req.files.arquivo.name);
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/retornos', authAdmin, (req, res) => {
  const db = getDb();
  const retornos = db.prepare('SELECT * FROM retornos_bancarios ORDER BY data_processamento DESC LIMIT 50').all();
  res.json(retornos);
});

// === EXPORTAÇÃO ===
router.post('/exportar/contribuintes', authAdmin, (req, res) => {
  const resultado = gerarArquivoContribuintes(req.body || {});
  res.download(resultado.filePath, resultado.nomeArquivo);
});

router.post('/exportar/guias', authAdmin, (req, res) => {
  const resultado = gerarArquivoGuias(req.body || {});
  res.download(resultado.filePath, resultado.nomeArquivo);
});

module.exports = router;

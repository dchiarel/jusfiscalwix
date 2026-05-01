const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(str) {
  if (!str) return '';
  const [ano, mes, dia] = str.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDocumento(doc) {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

async function gerarPDFGuia(guiaId, res) {
  const db = getDb();

  const guia = db.prepare(`
    SELECT g.*, c.razao_social, c.nome_fantasia, c.documento, c.tipo,
           c.endereco, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.cep,
           c.email, c.telefone, c.capital_social
    FROM guias g
    JOIN contribuintes c ON c.id = g.contribuinte_id
    WHERE g.id = ?
  `).get(guiaId);

  if (!guia) throw new Error('Guia não encontrada');

  const entidade = db.prepare('SELECT * FROM entidade WHERE id = 1').get();

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

  if (res) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="guia-${guia.numero}.pdf"`);
    doc.pipe(res);
  }

  const cor = entidade.cor_primaria || '#1a56db';
  const logoPath = entidade.logo_path
    ? path.join(__dirname, '..', 'public', entidade.logo_path)
    : null;

  // === CABEÇALHO ===
  doc.rect(0, 0, doc.page.width, 90).fill(cor);

  if (logoPath && fs.existsSync(logoPath)) {
    doc.image(logoPath, 45, 15, { height: 60, fit: [120, 60] });
    doc.fill('#ffffff').fontSize(14).font('Helvetica-Bold')
      .text(entidade.razao_social, 180, 22)
      .fontSize(9).font('Helvetica')
      .text(`CNPJ: ${formatarDocumento(entidade.cnpj)}`, 180, 40)
      .text(entidade.endereco || '', 180, 52)
      .text(`Tel: ${entidade.telefone || ''} | ${entidade.email || ''}`, 180, 64);
  } else {
    doc.fill('#ffffff').fontSize(16).font('Helvetica-Bold')
      .text(entidade.razao_social, 45, 22, { width: 510, align: 'center' })
      .fontSize(9).font('Helvetica')
      .text(`CNPJ: ${formatarDocumento(entidade.cnpj)}`, 45, 45, { width: 510, align: 'center' });
  }

  // === TÍTULO ===
  doc.fill('#333333').fontSize(14).font('Helvetica-Bold')
    .text('GUIA DE CONTRIBUIÇÃO SINDICAL', 40, 105, { align: 'center', width: 515 });

  doc.rect(40, 125, 515, 1).fill('#dddddd');

  // === DADOS DA GUIA ===
  let y = 135;
  function campo(label, valor, x, cx, largura) {
    doc.fill('#888888').fontSize(7).font('Helvetica')
      .text(label.toUpperCase(), x, y);
    doc.fill('#111111').fontSize(10).font('Helvetica-Bold')
      .text(valor || '-', cx, y + 1, { width: largura });
  }

  campo('Número da Guia', guia.numero, 40, 130, 130);
  campo('Competência', guia.competencia ? guia.competencia.split('-').reverse().join('/') : '', 280, 360, 90);
  campo('Vencimento', formatarData(guia.vencimento), 460, 510, 60);

  y += 30;
  doc.rect(40, y, 515, 1).fill('#eeeeee');
  y += 8;

  // === DADOS DO CONTRIBUINTE ===
  doc.fill(cor).fontSize(10).font('Helvetica-Bold')
    .text('DADOS DO CONTRIBUINTE', 40, y);
  y += 16;

  campo('Razão Social / Nome', guia.razao_social, 40, 130, 390);
  y += 22;
  campo(guia.tipo === 'PJ' ? 'CNPJ' : 'CPF', formatarDocumento(guia.documento), 40, 130, 150);
  if (guia.tipo === 'PJ') {
    campo('Capital Social', formatarMoeda(guia.capital_social), 260, 340, 120);
  }
  y += 22;

  const enderecoCompleto = [
    guia.endereco,
    guia.numero,
    guia.complemento,
    guia.bairro,
    guia.cidade && guia.uf ? `${guia.cidade}/${guia.uf}` : guia.cidade,
    guia.cep,
  ].filter(Boolean).join(', ');

  campo('Endereço', enderecoCompleto, 40, 130, 390);
  y += 22;

  if (guia.email) { campo('E-mail', guia.email, 40, 130, 200); }
  if (guia.telefone) { campo('Telefone', guia.telefone, 280, 340, 120); }

  y += 28;
  doc.rect(40, y, 515, 1).fill('#eeeeee');
  y += 8;

  // === COMPOSIÇÃO DO VALOR ===
  doc.fill(cor).fontSize(10).font('Helvetica-Bold')
    .text('COMPOSIÇÃO DO VALOR', 40, y);
  y += 16;

  function linhaDupla(label, valor, destaque = false) {
    doc.fill(destaque ? '#111111' : '#444444')
      .fontSize(destaque ? 11 : 10)
      .font(destaque ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, 40, y, { width: 350 })
      .text(valor, 390, y, { width: 165, align: 'right' });
    y += destaque ? 18 : 16;
  }

  linhaDupla('Valor Principal', formatarMoeda(guia.valor_principal));
  if (guia.valor_multa > 0) linhaDupla('Multa por Atraso', formatarMoeda(guia.valor_multa));
  if (guia.valor_juros > 0) linhaDupla('Juros de Mora', formatarMoeda(guia.valor_juros));

  doc.rect(40, y, 515, 1).fill(cor);
  y += 6;
  linhaDupla('VALOR TOTAL A PAGAR', formatarMoeda(guia.valor_total), true);
  doc.rect(40, y, 515, 1).fill(cor);
  y += 10;

  // === HISTÓRICO DE CÁLCULO ===
  if (guia.historico_calculo) {
    y += 6;
    doc.fill('#888888').fontSize(7).font('Helvetica')
      .text('BASE DE CÁLCULO', 40, y);
    y += 10;
    doc.fill('#555555').fontSize(8)
      .text(guia.historico_calculo, 40, y, { width: 515 });
    y += 20;
  }

  // === STATUS ===
  if (guia.status === 'paga') {
    const statusY = y;
    doc.rect(40, statusY, 515, 35).fill('#d1fae5');
    doc.fill('#065f46').fontSize(12).font('Helvetica-Bold')
      .text('GUIA PAGA', 40, statusY + 10, { align: 'center', width: 515 });
    doc.fill('#065f46').fontSize(9).font('Helvetica')
      .text(`Pagamento em ${formatarData(guia.data_pagamento)} | Valor: ${formatarMoeda(guia.valor_pago)}`,
        40, statusY + 22, { align: 'center', width: 515 });
    y = statusY + 45;
  } else if (guia.status === 'vencida') {
    doc.rect(40, y, 515, 25).fill('#fee2e2');
    doc.fill('#991b1b').fontSize(11).font('Helvetica-Bold')
      .text('GUIA VENCIDA - Sujeita a encargos por atraso', 40, y + 7, { align: 'center', width: 515 });
    y += 35;
  }

  // === INSTRUÇÕES ===
  const instrucoes = entidade.instrucoes_boleto || 'Não receber após o vencimento.';
  y += 8;
  doc.fill('#888888').fontSize(7).font('Helvetica')
    .text('INSTRUÇÕES', 40, y);
  y += 10;
  doc.fill('#555555').fontSize(8)
    .text(instrucoes, 40, y, { width: 515 });

  // === RODAPÉ ===
  const rodapeY = doc.page.height - 40;
  doc.rect(0, rodapeY - 5, doc.page.width, 45).fill('#f3f4f6');
  doc.fill('#6b7280').fontSize(8).font('Helvetica')
    .text(
      entidade.rodape_texto || `${entidade.razao_social} - Guia emitida em ${formatarData(new Date().toISOString().split('T')[0])}`,
      40, rodapeY + 2, { align: 'center', width: 515 }
    );

  doc.end();
  return doc;
}

module.exports = { gerarPDFGuia };

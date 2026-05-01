const { getDb } = require('../database/db');

function calcularEncargos(valorPrincipal, vencimento) {
  const db = getDb();
  const config = db.prepare('SELECT * FROM config_encargos WHERE id = 1').get();
  const hoje = new Date();
  const dtVencimento = new Date(vencimento);

  if (hoje <= dtVencimento) {
    return { multa: 0, juros: 0, diasAtraso: 0 };
  }

  const diasAtraso = Math.floor((hoje - dtVencimento) / (1000 * 60 * 60 * 24));
  if (diasAtraso <= (config.dias_carencia || 0)) {
    return { multa: 0, juros: 0, diasAtraso };
  }

  const multa = valorPrincipal * (config.multa_percentual / 100);
  const mesesAtraso = diasAtraso / 30;
  const juros = valorPrincipal * (config.juros_ao_mes / 100) * mesesAtraso;

  return {
    multa: Number(multa.toFixed(2)),
    juros: Number(juros.toFixed(2)),
    diasAtraso,
  };
}

function calcularValorContribuicao(contribuinte, competencia) {
  const db = getDb();
  const [ano] = (competencia || '').split('-');

  const faixas = db.prepare(`
    SELECT * FROM tabela_calculo
    WHERE ativo = 1
      AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
      AND vigencia_inicio <= ?
    ORDER BY faixa_min ASC
  `).all(`${ano}-01-01`, `${ano}-12-31`);

  if (!faixas || faixas.length === 0) {
    return { valor: 0, historico: 'Sem tabela de cálculo vigente' };
  }

  const primeiro = faixas[0];
  let valor = 0;
  let historico = '';

  if (primeiro.tipo === 'faixa_capital') {
    const capital = contribuinte.capital_social || 0;
    const faixa = faixas.find(f => {
      const acimaDo = capital >= (f.faixa_min || 0);
      const abaixoDo = f.faixa_max === null || capital <= f.faixa_max;
      return acimaDo && abaixoDo;
    });
    if (faixa) {
      valor = faixa.valor_resultado || 0;
      historico = `Faixa de capital: R$ ${capital.toLocaleString('pt-BR')} → ${faixa.descricao} → R$ ${valor.toLocaleString('pt-BR')}`;
    }
  } else if (primeiro.tipo === 'percentual') {
    const base =
      primeiro.base_calculo === 'capital_social'
        ? contribuinte.capital_social || 0
        : contribuinte.folha_pagamento || 0;
    valor = base * (primeiro.percentual / 100);
    historico = `${primeiro.percentual}% sobre R$ ${base.toLocaleString('pt-BR')} = R$ ${valor.toFixed(2)}`;
  } else if (primeiro.tipo === 'fixo') {
    valor = primeiro.valor_fixo || 0;
    historico = `Valor fixo: R$ ${valor.toLocaleString('pt-BR')}`;
  }

  return { valor: Number(valor.toFixed(2)), historico };
}

function gerarNumeroGuia() {
  const db = getDb();
  const hoje = new Date();
  const prefixo = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const ultima = db.prepare(
    "SELECT numero FROM guias WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1"
  ).get(`${prefixo}%`);

  let seq = 1;
  if (ultima) {
    const parteSeq = parseInt(ultima.numero.slice(-6), 10);
    seq = parteSeq + 1;
  }
  return `${prefixo}${String(seq).padStart(6, '0')}`;
}

function calcularVencimento(competencia) {
  const [ano, mes] = (competencia || '').split('-').map(Number);
  // Vencimento padrão: último dia útil do mês seguinte
  const ultimoDia = new Date(ano, mes, 0);
  return ultimoDia.toISOString().split('T')[0];
}

module.exports = {
  calcularEncargos,
  calcularValorContribuicao,
  gerarNumeroGuia,
  calcularVencimento,
};

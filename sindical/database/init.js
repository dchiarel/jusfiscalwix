const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sindical.db');

function initDatabase() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Configuração da entidade (logotipo, cores, razão social)
    CREATE TABLE IF NOT EXISTS entidade (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      razao_social TEXT NOT NULL DEFAULT 'Sindicato da Categoria',
      cnpj TEXT NOT NULL DEFAULT '00.000.000/0001-00',
      endereco TEXT,
      telefone TEXT,
      email TEXT,
      site TEXT,
      cor_primaria TEXT NOT NULL DEFAULT '#1a56db',
      cor_secundaria TEXT NOT NULL DEFAULT '#1e429f',
      cor_texto_header TEXT NOT NULL DEFAULT '#ffffff',
      logo_path TEXT,
      banner_path TEXT,
      rodape_texto TEXT DEFAULT 'Contribuição Sindical - Todos os direitos reservados',
      conta_banco TEXT,
      agencia TEXT,
      conta_corrente TEXT,
      cedente_nome TEXT,
      cedente_cnpj TEXT,
      codigo_banco TEXT DEFAULT '001',
      instrucoes_boleto TEXT DEFAULT 'Não receber após o vencimento.\nEm caso de dúvidas, entre em contato com o sindicato.',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Tabela de cálculo: faixas de valores para contribuição
    CREATE TABLE IF NOT EXISTS tabela_calculo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL DEFAULT 'percentual' CHECK(tipo IN ('percentual','fixo','faixa_capital')),
      descricao TEXT NOT NULL,
      base_calculo TEXT NOT NULL DEFAULT 'capital_social'
        CHECK(base_calculo IN ('capital_social','folha_pagamento','fixo')),
      percentual REAL,
      valor_fixo REAL,
      faixa_min REAL,
      faixa_max REAL,
      valor_resultado REAL,
      referencia TEXT NOT NULL DEFAULT 'anual' CHECK(referencia IN ('anual','mensal')),
      vigencia_inicio TEXT NOT NULL DEFAULT (date('now')),
      vigencia_fim TEXT,
      ativo INTEGER NOT NULL DEFAULT 1
    );

    -- Configuração de multa e juros
    CREATE TABLE IF NOT EXISTS config_encargos (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      multa_percentual REAL NOT NULL DEFAULT 2.0,
      juros_ao_mes REAL NOT NULL DEFAULT 1.0,
      dias_carencia INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Contribuintes (PJ = CNPJ, PF = CPF)
    CREATE TABLE IF NOT EXISTS contribuintes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL DEFAULT 'PJ' CHECK(tipo IN ('PJ','PF')),
      documento TEXT NOT NULL UNIQUE,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT,
      endereco TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      cidade TEXT,
      uf TEXT,
      cep TEXT,
      telefone TEXT,
      email TEXT,
      capital_social REAL DEFAULT 0,
      num_empregados INTEGER DEFAULT 0,
      folha_pagamento REAL DEFAULT 0,
      atividade_economica TEXT,
      data_abertura TEXT,
      situacao TEXT DEFAULT 'ativo' CHECK(situacao IN ('ativo','inativo','suspenso')),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Guias de contribuição
    CREATE TABLE IF NOT EXISTS guias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      contribuinte_id INTEGER NOT NULL REFERENCES contribuintes(id),
      competencia TEXT NOT NULL,
      valor_principal REAL NOT NULL,
      valor_multa REAL NOT NULL DEFAULT 0,
      valor_juros REAL NOT NULL DEFAULT 0,
      valor_total REAL NOT NULL,
      vencimento TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberta'
        CHECK(status IN ('aberta','paga','cancelada','vencida')),
      data_pagamento TEXT,
      valor_pago REAL,
      nosso_numero TEXT,
      linha_digitavel TEXT,
      cod_barras TEXT,
      historico_calculo TEXT,
      observacoes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Retornos bancários processados
    CREATE TABLE IF NOT EXISTS retornos_bancarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_arquivo TEXT NOT NULL,
      data_processamento TEXT DEFAULT (datetime('now','localtime')),
      total_registros INTEGER DEFAULT 0,
      registros_baixados INTEGER DEFAULT 0,
      registros_erro INTEGER DEFAULT 0,
      conteudo_resumo TEXT
    );

    -- Registros de retorno individual
    CREATE TABLE IF NOT EXISTS retorno_registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retorno_id INTEGER NOT NULL REFERENCES retornos_bancarios(id),
      guia_id INTEGER REFERENCES guias(id),
      nosso_numero TEXT,
      valor_pago REAL,
      data_pagamento TEXT,
      status_processamento TEXT CHECK(status_processamento IN ('baixado','erro','nao_encontrado')),
      mensagem TEXT
    );

    -- Exportações geradas
    CREATE TABLE IF NOT EXISTS exportacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      nome_arquivo TEXT NOT NULL,
      data_geracao TEXT DEFAULT (datetime('now','localtime')),
      total_registros INTEGER DEFAULT 0,
      filtro_inicio TEXT,
      filtro_fim TEXT
    );

    -- Usuários admin
    CREATE TABLE IF NOT EXISTS admin_usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL DEFAULT 'operador' CHECK(perfil IN ('admin','operador')),
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Seed: configuração inicial da entidade
    INSERT OR IGNORE INTO entidade (id, razao_social, cnpj)
      VALUES (1, 'Sindicato da Categoria', '00.000.000/0001-00');

    -- Seed: configuração de encargos padrão
    INSERT OR IGNORE INTO config_encargos (id, multa_percentual, juros_ao_mes, dias_carencia)
      VALUES (1, 2.0, 1.0, 0);

    -- Seed: tabela de cálculo por faixa de capital social (art. 580 CLT)
    INSERT OR IGNORE INTO tabela_calculo
      (id, tipo, descricao, base_calculo, faixa_min, faixa_max, valor_resultado, referencia, vigencia_inicio)
    VALUES
      (1,'faixa_capital','Dispensadas (sem empregados, capital até 1.000)',  'capital_social', 0,         1000,     0,      'anual', '2024-01-01'),
      (2,'faixa_capital','Capital de R$ 1.000,01 até R$ 5.000',             'capital_social', 1000.01,   5000,     180,    'anual', '2024-01-01'),
      (3,'faixa_capital','Capital de R$ 5.000,01 até R$ 10.000',            'capital_social', 5000.01,   10000,    360,    'anual', '2024-01-01'),
      (4,'faixa_capital','Capital de R$ 10.000,01 até R$ 20.000',           'capital_social', 10000.01,  20000,    600,    'anual', '2024-01-01'),
      (5,'faixa_capital','Capital de R$ 20.000,01 até R$ 50.000',           'capital_social', 20000.01,  50000,    900,    'anual', '2024-01-01'),
      (6,'faixa_capital','Capital de R$ 50.000,01 até R$ 100.000',          'capital_social', 50000.01,  100000,   1800,   'anual', '2024-01-01'),
      (7,'faixa_capital','Capital acima de R$ 100.000',                     'capital_social', 100000.01, NULL,     3000,   'anual', '2024-01-01');
  `);

  console.log('Banco de dados inicializado com sucesso:', DB_PATH);
  db.close();
}

module.exports = { initDatabase, DB_PATH };

if (require.main === module) {
  initDatabase();
}

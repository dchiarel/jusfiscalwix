require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const guiasRouter = require('./routes/guias');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));
app.use(express.static(path.join(__dirname, 'public')));

// API pública
app.use('/api/guias', guiasRouter);

// API administrativa (protegida por secret header)
app.use('/api/admin', adminRouter);

// Configuração da entidade disponível para o frontend (apenas dados de exibição)
app.get('/api/config', (req, res) => {
  const { getDb } = require('./database/db');
  const db = getDb();
  const e = db.prepare('SELECT razao_social, cnpj, endereco, telefone, email, site, cor_primaria, cor_secundaria, cor_texto_header, logo_path, banner_path, rodape_texto FROM entidade WHERE id=1').get();
  res.json(e || {});
});

// SPA fallback — servir index.html para rotas desconhecidas
app.get('*', (req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sistema Sindical rodando em http://localhost:${PORT}`);
});

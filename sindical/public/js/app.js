/* ===== UTILITÁRIOS GLOBAIS ===== */

function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDocumento(doc) {
  const d = (doc || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc;
}

function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function mascaraCNPJ(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 18);
  if (v.length <= 11) {
    v = v.replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  } else {
    v = v.replace(/(\d{2})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1/$2')
         .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }
  input.value = v;
}

function mascaraCEP(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 8);
  input.value = v.replace(/(\d{5})(\d)/, '$1-$2');
}

async function buscarCEP(cep, form) {
  const c = (cep || '').replace(/\D/g, '');
  if (c.length !== 8) return;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const d = await r.json();
    if (d.erro) return;
    if (form.endereco) form.endereco.value = d.logradouro || '';
    if (form.bairro) form.bairro.value = d.bairro || '';
    if (form.cidade) form.cidade.value = d.localidade || '';
    if (form.uf) form.uf.value = d.uf || '';
  } catch (_) {}
}

async function carregarConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    if (!cfg.cor_primaria) return;

    document.documentElement.style.setProperty('--cor-primaria', cfg.cor_primaria);
    document.documentElement.style.setProperty('--cor-secundaria', cfg.cor_secundaria || cfg.cor_primaria);
    document.documentElement.style.setProperty('--cor-texto-header', cfg.cor_texto_header || '#ffffff');

    if (cfg.razao_social) {
      document.querySelectorAll('.entidade-nome').forEach(el => { el.textContent = cfg.razao_social; });
    }
    if (cfg.logo_path) {
      document.querySelectorAll('.header-logo-placeholder').forEach(el => {
        const img = document.createElement('img');
        img.src = cfg.logo_path;
        img.alt = cfg.razao_social || 'Logo';
        img.className = 'header-logo';
        el.replaceWith(img);
      });
    }
    if (cfg.rodape_texto) {
      document.querySelectorAll('.rodape-texto').forEach(el => { el.textContent = cfg.rodape_texto; });
    }
  } catch (_) {}
}

function showAlert(msg, tipo = 'info', container = null) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const div = document.createElement('div');
  div.className = `alert alert-${tipo}`;
  div.innerHTML = `<span>${icons[tipo]}</span><span>${msg}</span>`;
  const el = container || document.querySelector('.alerts-container');
  if (el) {
    el.innerHTML = '';
    el.appendChild(div);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  return div;
}

// Inicializar ao carregar
document.addEventListener('DOMContentLoaded', carregarConfig);

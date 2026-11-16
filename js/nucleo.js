/* TRIA-PME — núcleo do método (E1..E5), versão 0.2.0 (PBL8).
 * Funções puras, sem acesso à interface (decisão DA3 do PBL4).
 * Todas as funções recebem K = { perfil, taxonomia, itens, controles, regras }.
 * Mudanças do PBL8 em relação à versão 0.1.0 (port de motor.py):
 *  - derivarPerfil: a tradução das respostas da E1 em campos do perfil vem de perfil.json (antes estava em app.js);
 *  - escala de frequência de 3 opções (nunca / já aconteceu / não sei), com valores definidos em regras.json;
 *  - frequência preenchida pela E2 quando uma pergunta já relata o evento (regras.frequenciaPelaE2);
 *  - piso de impacto definido pelo perfil e pela E2 (regras.pisosDeImpacto);
 *  - invariantes novos (INV9 a INV11). */
(function (raiz) {
  "use strict";

  function arred2(x) { return Math.round(x * 100) / 100; }
  function comoConjunto(v) {
    if (Array.isArray(v)) return new Set(v);
    if (v === undefined || v === null) return new Set();
    return new Set([v]);
  }
  function intersecta(a, b) { for (const x of a) if (b.has(x)) return true; return false; }

  function indices(K) {
    const cats = {}, itens = {}, ctrls = {};
    K.taxonomia.categorias.forEach(c => cats[c.codigo] = c);
    K.itens.itens.forEach(i => itens[i.codigo] = i);
    K.controles.controles.forEach(c => ctrls[c.codigo] = c);
    return { cats, itens, ctrls };
  }

  /* ---------------------------------------------------------- invariantes */
  function invariantes(K) {
    const { cats, itens, ctrls } = indices(K);
    const r = [];
    const nCats = Object.keys(cats).length;
    r.push({ id: "INV1", nome: "No máximo 12 categorias de 1º nível", ok: nCats <= 12, detalhe: nCats + " categorias" });
    const dom = K.taxonomia.coberturaDeclarada.dominiosDoAIRR;
    const cob = Object.values(dom).filter(cs => cs.length).length;
    r.push({ id: "INV2", nome: "Cobertura dos domínios do AI Risk Repository", ok: cob === Object.keys(dom).length, detalhe: cob + "/" + Object.keys(dom).length + " domínios" });
    const semFonte = Object.values(cats).filter(c => !(c.fontesNormativas || []).length);
    r.push({ id: "INV3", nome: "Toda categoria com fonte normativa", ok: !semFonte.length, detalhe: semFonte.length + " sem fonte" });
    const porCat = {}; Object.keys(cats).forEach(k => porCat[k] = 0);
    Object.values(ctrls).forEach(c => c.categorias.forEach(k => porCat[k] = (porCat[k] || 0) + 1));
    const minimo = Math.min.apply(null, Object.values(porCat));
    r.push({ id: "INV4", nome: "Pelo menos 2 controles por categoria", ok: minimo >= 2, detalhe: "mínimo observado: " + minimo });
    const alc = new Set(Object.values(itens).map(i => i.categoria));
    const orfas = Object.keys(cats).filter(c => !alc.has(c));
    r.push({ id: "INV5", nome: "Nenhuma categoria sem item", ok: !orfas.length, detalhe: orfas.length ? orfas.join(", ") : "nenhuma órfã" });
    const inval = Object.values(itens).filter(i => !cats[i.categoria]);
    r.push({ id: "INV6", nome: "Todo item aponta categoria existente", ok: !inval.length, detalhe: inval.length + " inválidos" });
    const papeis = new Set(K.controles.papeisAdmitidos);
    const fora = Object.values(ctrls).filter(c => !papeis.has(c.papelSugerido));
    r.push({ id: "INV7", nome: "Proporcionalidade dos papéis", ok: !fora.length, detalhe: fora.length + " fora da lista admitida" });
    const naoVerif = Object.values(itens).filter(i => !i.verificavel);
    r.push({ id: "INV8", nome: "Todo item comportamental e verificável", ok: !naoVerif.length, detalhe: naoVerif.length + " não verificáveis" });
    /* novos no PBL8 */
    const sub = Object.assign({}, K.taxonomia.coberturaDeclarada.subdominiosAplicaveisDoAIRR || {}); delete sub.nota;
    const nSub = Object.keys(sub).length, cobSub = Object.values(sub).filter(cs => cs.length && cs.every(c => cats[c])).length;
    r.push({ id: "INV9", nome: "Cobertura de ≥ 90% dos subdomínios aplicáveis do AI Risk Repository", ok: nSub > 0 && cobSub / nSub >= 0.9, detalhe: cobSub + "/" + nSub + " subdomínios" });
    const vinc = (K.regras.frequenciaPelaE2 || { vinculos: [] }).vinculos;
    const vincRuins = vinc.filter(v => !itens[v.item] || itens[v.item].categoria !== v.categoria || !itens[v.item].inverso);
    r.push({ id: "INV10", nome: "Frequência pela E2 só a partir de pergunta que relata o evento da própria categoria", ok: !vincRuins.length, detalhe: vinc.length + " vínculos, " + vincRuins.length + " inválidos" });
    const mods = new Set(K.regras.modificadores.map(m => m.codigo));
    const pisos = (K.regras.pisosDeImpacto || { regras: [] }).regras;
    const pisosRuins = pisos.filter(p => p.categorias.some(c => !cats[c]) || (p.se.modificador && !mods.has(p.se.modificador)) || (p.se.resposta && !itens[p.se.resposta.item]) || !(p.piso >= 1 && p.piso <= 5) || !p.justificativa);
    r.push({ id: "INV11", nome: "Todo piso de impacto aponta elementos existentes e tem justificativa", ok: !pisosRuins.length, detalhe: pisos.length + " regras, " + pisosRuins.length + " inválidas" });
    return r;
  }

  /* ------------------------------------------------------------------ E1 */
  /* Traduz as respostas da E1 nos campos do perfil usados pelo método, seguindo perfil.json. */
  function derivarPerfil(K, e1) {
    const out = {};
    K.perfil.derivacoes.forEach(d => {
      if (d.casos) {
        const caso = d.casos.find(c => Object.keys(c.se).every(k => e1[k] === c.se[k]));
        out[d.campo] = (caso ? caso.valor : d.senao).slice();
      } else if (d.booleano) {
        out[d.campo] = e1[d.de] === true;
      } else if (d.remover) {
        out[d.campo] = (e1[d.de] || []).filter(v => !d.remover.includes(v));
      } else {
        out[d.campo] = e1[d.de];
      }
    });
    return out;
  }

  function modificadoresAtivos(K, perfil) {
    return K.regras.modificadores.filter(m => {
      const val = comoConjunto(perfil[m.derivadoDe.campoDoPerfil]);
      return intersecta(val, new Set(m.derivadoDe.ligaSe));
    }).map(m => m.codigo);
  }

  function aplicavel(cond, perfil) {
    cond = cond || {};
    for (const k of Object.keys(cond)) {
      const v = cond[k];
      if (Array.isArray(v)) {
        if (!intersecta(comoConjunto(perfil[k]), new Set(v))) return false;
      } else if (perfil[k] !== v) {
        return false;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ E2 */
  function itensAplicaveis(K, perfil) {
    return K.itens.itens.filter(i => aplicavel(i.condicaoDeAplicabilidade, perfil));
  }

  function instanciaRisco(item, resposta) {
    if (resposta === undefined || resposta === null) return null;
    return item.inverso ? (resposta === "sim" || resposta === "naoSei")
                        : (resposta === "nao" || resposta === "naoSei");
  }

  /* Regra de não anulação: categoria só é excluída quando TODOS os itens
   * aplicáveis que a alcançam vieram sem indicar exposição. */
  function identificar(K, perfil, respostas) {
    const aplic = itensAplicaveis(K, perfil);
    const porCat = {};
    aplic.forEach(i => {
      const rsp = respostas[i.codigo];
      if (rsp === undefined) return;
      (porCat[i.categoria] = porCat[i.categoria] || []).push({ item: i.codigo, resposta: rsp, instancia: instanciaRisco(i, rsp) });
    });
    const riscos = Object.keys(porCat).filter(c => porCat[c].some(m => m.instancia)).sort();
    const excluidas = Object.keys(porCat).filter(c => !riscos.includes(c)).sort();
    const alcancaveis = new Set(aplic.map(i => i.categoria));
    const foraDoPerfil = K.taxonomia.categorias.map(c => c.codigo).filter(c => !alcancaveis.has(c));
    const pendentes = aplic.filter(i => respostas[i.codigo] === undefined).map(i => i.codigo);
    return { aplicaveis: aplic.map(i => i.codigo), evidencias: porCat, riscos, excluidas, foraDoPerfil, pendentes };
  }

  /* Intensidade da evidência: quantas das perguntas respondidas da categoria indicaram exposição. */
  function intensidade(e2, categoria) {
    const ev = e2.evidencias[categoria] || [];
    return { expostas: ev.filter(m => m.instancia).length, total: ev.length };
  }

  /* ------------------------------------------------------------------ E3 */
  function opcaoFrequencia(K, codigo) {
    return K.regras.escalas.frequencia.opcoes.find(o => o.codigo === codigo) || null;
  }

  /* Frequência que a própria E2 já respondeu: { C03: { codigo: "jaAconteceu", item: "I-08", resposta: "sim" } } */
  function frequenciaPelaE2(K, perfil, respostas) {
    const regra = K.regras.frequenciaPelaE2;
    const out = {};
    if (!regra) return out;
    const aplic = new Set(itensAplicaveis(K, perfil).map(i => i.codigo));
    regra.vinculos.forEach(v => {
      const rsp = respostas[v.item];
      if (!aplic.has(v.item) || !regra.mapeamento[rsp]) return;
      const atual = out[v.categoria];
      const cod = regra.mapeamento[rsp];
      /* "jaAconteceu" prevalece sobre "naoSei" se houver mais de um vínculo para a mesma categoria */
      if (!atual || (atual.codigo === "naoSei" && cod === "jaAconteceu")) out[v.categoria] = { codigo: cod, item: v.item, resposta: rsp };
    });
    return out;
  }

  /* Piso de impacto da categoria: { valor, regras: [{codigo, piso, motivo}] } */
  function pisoDeImpacto(K, categoria, perfil, modsAtivos, respostas) {
    const regras = (K.regras.pisosDeImpacto || { regras: [] }).regras;
    const aplicadas = regras.filter(p => {
      if (!p.categorias.includes(categoria)) return false;
      if (p.se.modificador) return modsAtivos.includes(p.se.modificador);
      if (p.se.perfil) return aplicavel(p.se.perfil, perfil);
      if (p.se.resposta) return p.se.resposta.valores.includes((respostas || {})[p.se.resposta.item]);
      return false;
    });
    const valor = aplicadas.reduce((m, p) => Math.max(m, p.piso), 1);
    return { valor, regras: aplicadas.map(p => ({ codigo: p.codigo, piso: p.piso, motivo: p.motivo })) };
  }

  function faixaDe(K, escore) {
    return K.regras.faixas.find(f => escore >= f.min);
  }

  /* I = impacto declarado (1..5); F = código da frequência; piso = número (padrão 1). */
  function pontuar(K, categoria, I, F, modsAtivos, piso) {
    const mods = {}; K.regras.modificadores.forEach(m => mods[m.codigo] = m);
    const incidentes = modsAtivos.filter(m => mods[m].incideSobre.includes(categoria));
    const fator = arred2(1 + incidentes.reduce((s, m) => s + mods[m].peso, 0));
    const Ief = Math.max(I, piso || 1);
    const of = opcaoFrequencia(K, F);
    const P = of.valor;
    const escore = arred2(Ief * P * fator);
    const faixa = faixaDe(K, escore);
    return { categoria, Ideclarado: I, piso: piso || 1, I: Ief, F, P, base: Ief * P, modificadores: incidentes, fator, escore,
             faixa: faixa.nome, faixaRotulo: faixa.rotulo,
             acima: escore >= K.regras.limiarDeAcaoObrigatoria };
  }

  /* avaliacoes: { C01: { I: 3, F: "nunca" } }. A frequência preenchida pela E2 prevalece sobre a declarada. */
  function priorizar(K, riscos, avaliacoes, modsAtivos, perfil, respostas) {
    const { cats } = indices(K);
    const fE2 = frequenciaPelaE2(K, perfil || {}, respostas || {});
    const out = [];
    riscos.forEach(c => {
      const a = avaliacoes[c] || {};
      const F = fE2[c] ? fE2[c].codigo : a.F;
      if (!a.I || !F || !opcaoFrequencia(K, F)) return;
      const piso = pisoDeImpacto(K, c, perfil || {}, modsAtivos, respostas);
      const r = pontuar(K, c, a.I, F, modsAtivos, piso.valor);
      r.nome = cats[c].nome;
      r.pisoRegras = piso.regras;
      r.frequenciaPelaE2 = fE2[c] || null;
      out.push(r);
    });
    out.sort((a, b) => b.escore - a.escore || a.categoria.localeCompare(b.categoria));
    return out;
  }

  /* ------------------------------------------------------------------ E5 */
  function derivarControles(K, categoria, perfil) {
    const ord = K.regras.ordenacaoDeControles;
    const oE = {}, oH = {};
    ord.ordem.forEach((e, n) => oE[e] = n);
    ord.ordemSecundaria.forEach((h, n) => oH[h] = n);
    return K.controles.controles
      .filter(c => c.categorias.includes(categoria) && aplicavel(c.condicaoDeAplicabilidade, perfil))
      .sort((a, b) => (oE[a.esforco] - oE[b.esforco]) || (oH[a.horizonte] - oH[b.horizonte]) || a.codigo.localeCompare(b.codigo));
  }

  function derivarPlano(K, registro, perfil) {
    const plano = {};
    registro.filter(r => r.acima).forEach(r => {
      plano[r.categoria] = derivarControles(K, r.categoria, perfil).map(c => c.codigo);
    });
    return plano;
  }

  const api = { arred2, indices, invariantes, derivarPerfil, modificadoresAtivos, aplicavel, itensAplicaveis,
                instanciaRisco, identificar, intensidade, opcaoFrequencia, frequenciaPelaE2, pisoDeImpacto,
                faixaDe, pontuar, priorizar, derivarControles, derivarPlano };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.TriaNucleo = api;
})(typeof window !== "undefined" ? window : this);

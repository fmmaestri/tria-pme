/* TRIA-PME — camada de apresentação (assistente por etapas, painel, editor do plano, exportador).
 * Toda regra do método vive em nucleo.js; aqui só há interface e estado da sessão. */
(function () {
  "use strict";
  const N = window.TriaNucleo;
  let K = null, IDX = null, CASO = null;

  /* ============================================================ vocabulário */
  const ETAPAS = [
    { id: "inicio", n: "", nome: "Início" },
    { id: "E1", n: "E1", nome: "Contexto" },
    { id: "E2", n: "E2", nome: "Identificação" },
    { id: "E3", n: "E3", nome: "Priorização" },
    { id: "E4", n: "E4", nome: "Responsáveis" },
    { id: "E5", n: "E5", nome: "Plano" },
    { id: "rel", n: "", nome: "Relatório" }
  ];
  /* Vocabulário da E1: vem de perfil.json (PBL8, correção da DA1), preenchido em carregar(). */
  let SETORES = [], PORTES = [], DADOS = [], MODOS = [], PAPEIS = [], PAPEL_CURTO = {}, ALCANCE = [];
  const RESP = [["sim", "Sim"], ["nao", "Não"], ["naoSei", "Não sei"]];
  const HORIZ = { imediato: "imediato", curto: "curto prazo", medio: "médio prazo" };
  const ESF = { baixo: "baixo", medio: "médio", alto: "alto" };
  const TIPO = { preventivo: "preventivo", detectivo: "detectivo", corretivo: "corretivo" };
  const GATILHOS = "entrada de novo sistema de IA, mudança relevante de fornecedor ou seis meses decorridos";
  const CHAVE_LOCAL = "tria-pme-sessao-v2";

  /* ============================================================ estado */
  let S = null;
  let etapa = "inicio";
  let entrouEm = Date.now();
  let grupoAtual = 0;
  let verResumoE2 = false;
  let verRegistroE3 = false; // PBL8: o escore só aparece depois que todas as categorias foram avaliadas
  let removendo = null;      // chave "C01|CT-01" em edição de remoção
  let persistir = false;
  let mensagem = null;       // aviso de topo transitório

  function sessaoVazia() {
    return {
      ferramenta: "TRIA-PME",
      versaoDoConteudo: versoes(),
      iniciadaEm: new Date().toISOString(),
      concluidaEm: null,
      origem: "nova",
      perfil: {
        organizacao: "", porte: "", setor: "", naturezaDosDados: [], modoDeAdocao: "",
        decideSobrePessoas: null, exposicaoAExterno: null, publicaConteudo: null, processaConteudoExterno: null,
        sistemasDeIA: [{ nome: "", finalidade: "", fornecedor: "", sancionado: "" }],
        pessoas: { direcao_ou_socio: "", responsavel_ti: "", responsavel_administrativo: "", responsavel_da_area: "" }
      },
      respostas: {},     // codigo -> { valor, evidencia }
      avaliacoes: {},    // categoria -> { I, F }  (F: "nunca" | "jaAconteceu" | "naoSei")
      responsaveis: {},  // categoria -> { nome, cargo }
      ajustes: { removidos: {}, horizontes: {} }, // "CAT|CT" -> justificativa / horizonte
      metricas: { tempoPorEtapa: {}, trilhaDeDecisao: [] }
    };
  }
  function versoes() {
    return { perfil: K.perfil.versao, taxonomia: K.taxonomia.versao, itens: K.itens.versao, controles: K.controles.versao, regras: K.regras.versao };
  }
  function trilha(evento, detalhe) {
    S.metricas.trilhaDeDecisao.push({ em: new Date().toISOString(), etapa, evento, detalhe: detalhe || "" });
  }

  /* ---------- perfil no vocabulário do motor: a regra de tradução está em perfil.json (N.derivarPerfil) */
  function perfilMotor(p) {
    p = p || S.perfil;
    const pm = N.derivarPerfil(K, p);
    pm.papeisExistentes = PAPEIS.map(x => x[0]).filter(k => (p.pessoas[k] || "").trim());
    return pm;
  }
  function respostasSimples() {
    const r = {}; Object.keys(S.respostas).forEach(k => r[k] = S.respostas[k].valor); return r;
  }

  /* ---------- derivações (sempre recalculadas a partir do estado) */
  function derivar() {
    const pm = perfilMotor();
    const rs = respostasSimples();
    const mods = N.modificadoresAtivos(K, pm);
    const e2 = N.identificar(K, pm, rs);
    const aval = {};
    Object.keys(S.avaliacoes).forEach(c => aval[c] = S.avaliacoes[c]);
    const fE2 = N.frequenciaPelaE2(K, pm, rs);
    const registro = N.priorizar(K, e2.riscos, aval, mods, pm, rs);
    const naoAvaliados = e2.riscos.filter(c => !registro.some(r => r.categoria === c));
    const acima = registro.filter(r => r.acima);
    const planoBase = N.derivarPlano(K, registro, pm);
    return { pm, rs, mods, e2, fE2, registro, naoAvaliados, acima, planoBase };
  }

  /* ---------- validação das transições (máquina de estados do PBL4, §5.3) */
  function pendenciasE1() {
    const p = S.perfil, f = [];
    if (!p.setor) f.push("setor de atuação");
    if (!p.porte) f.push("porte");
    if (!p.naturezaDosDados.length) f.push("tipos de dado tratados");
    if (!p.modoDeAdocao) f.push("forma de uso da IA");
    ALCANCE.forEach(q => { if (p[q.campo] === null || p[q.campo] === undefined) f.push("perguntas sobre o alcance da IA"); });
    if (!p.sistemasDeIA.some(s => s.nome.trim())) f.push("ao menos uma ferramenta de IA em uso");
    return Array.from(new Set(f));
  }
  function liberada(id, D) {
    D = D || derivar();
    const ordem = ETAPAS.map(e => e.id), i = ordem.indexOf(id);
    if (i <= 1) return true;
    if (pendenciasE1().length) return false;
    if (i === 2) return true;
    if (D.e2.pendentes.length) return false;
    if (i === 3) return true;
    if (D.naoAvaliados.length) return false;
    if (i === 4) return D.acima.length > 0;
    if (D.acima.some(r => !responsavelValido(r.categoria))) return false;
    if (i === 5) return true;
    return !!S.concluidaEm || etapa === "rel";
  }
  function responsavelValido(cat) {
    const r = S.responsaveis[cat];
    return !!(r && (r.nome || "").trim() && (r.cargo || "").trim());
  }
  function respDe(cat) {
    const r = S.responsaveis[cat];
    if (!r || !(r.nome || "").trim()) return "";
    return r.nome.trim() + ((r.cargo || "").trim() ? " (" + r.cargo.trim() + ")" : "");
  }
  function feita(id, D) {
    const ordem = ETAPAS.map(e => e.id), i = ordem.indexOf(id);
    if (i === 1) return !pendenciasE1().length;
    if (i === 2) return !pendenciasE1().length && !D.e2.pendentes.length;
    if (i === 3) return feita("E2", D) && !D.naoAvaliados.length;
    if (i === 4) return feita("E3", D) && D.acima.length > 0 && D.acima.every(r => responsavelValido(r.categoria));
    if (i === 5) return !!S.concluidaEm && feita("E3", D);
    return false;
  }

  /* ============================================================ utilidades */
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function num(x) { return x.toFixed(2).replace(".", ","); }
  function chipFaixa(r) { return `<span class="chip sev-${r.faixa}">${esc(r.faixaRotulo)}</span>`; }
  function nomeSetor(k) { const s = SETORES.find(x => x[0] === k); return s ? s[1] : "—"; }
  function pessoaDe(papel) { const n = (S.perfil.pessoas[papel] || "").trim(); return n ? `${n} (${PAPEL_CURTO[papel]})` : ""; }
  function rotuloF(cod) { const o = N.opcaoFrequencia(K, cod); return o ? { nunca: "nunca", jaAconteceu: "já aconteceu", naoSei: "não sei" }[cod] || cod : "—"; }
  function modRotulo(cod) { const m = K.regras.modificadores.find(x => x.codigo === cod); return m ? m.rotulo : cod; }
  function modCurto(cod) { return { m_dados_sensiveis: "dados sensíveis", m_decisao_sobre_pessoas: "decisão sobre pessoas", m_setor_regulado: "setor regulado" }[cod] || cod; }
  function fmtTempo(ms) { const s = Math.round(ms / 1000); const m = Math.floor(s / 60); return m + " min " + String(s % 60).padStart(2, "0") + " s"; }
  function tempoTotal() { const t = Object.assign({}, S.metricas.tempoPorEtapa); return Object.values(t).reduce((a, b) => a + b, 0) + (etapa !== "inicio" && etapa !== "rel" ? Date.now() - entrouEm : 0); }

  function salvarLocal() {
    if (!persistir || !S) return;
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ S, etapa })); } catch (e) { /* armazenamento indisponível */ }
  }
  function lerLocal() { try { const t = localStorage.getItem(CHAVE_LOCAL); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function apagarLocal() { try { localStorage.removeItem(CHAVE_LOCAL); } catch (e) { } }

  /* ============================================================ navegação */
  function irPara(id) {
    if (!S && id !== "inicio") return;
    const D = derivar();
    if (!liberada(id, D) && id !== "inicio") return;
    if (S && etapa !== "inicio" && etapa !== "rel") {
      S.metricas.tempoPorEtapa[etapa] = (S.metricas.tempoPorEtapa[etapa] || 0) + (Date.now() - entrouEm);
    }
    if (etapa === "E1" && id !== "E1" && S) descartarOrfas();
    const anterior = etapa;
    etapa = id; entrouEm = Date.now(); removendo = null;
    if (id === "E2") { verResumoE2 = !D.e2.pendentes.length && D.e2.aplicaveis.length > 0 && verResumoE2; }
    if (id === "E3") { verRegistroE3 = ["E4", "E5", "rel"].includes(anterior) && !D.naoAvaliados.length; }
    salvarLocal();
    render();
    window.scrollTo(0, 0);
  }
  /* Revisão de contexto invalida respostas dependentes (PBL4 §5.3). */
  function descartarOrfas() {
    const aplic = new Set(N.itensAplicaveis(K, perfilMotor()).map(i => i.codigo));
    const orfas = Object.keys(S.respostas).filter(k => !aplic.has(k));
    if (orfas.length) {
      orfas.forEach(k => delete S.respostas[k]);
      trilha("respostas descartadas por revisão de contexto", orfas.join(", "));
      mensagem = { tipo: "", texto: `${orfas.length} resposta(s) descartada(s) porque a pergunta deixou de se aplicar ao novo perfil: ${orfas.join(", ")}.` };
    }
  }

  /* ============================================================ render geral */
  function render() {
    const D = S ? derivar() : null;
    $("#trilho").innerHTML = ETAPAS.map(e => {
      const pode = e.id === "inicio" || (S && liberada(e.id, D));
      const fz = S && D && feita(e.id, D);
      return `<button type="button" data-ir="${e.id}" ${pode ? "" : "disabled"} ${etapa === e.id ? 'aria-current="step"' : ""} class="${fz ? "feita" : ""}">${e.n ? `<span class="n">${e.n}</span>` : ""}${e.nome}</button>`;
    }).join("");
    const alvo = $("#conteudo");
    const msg = mensagem ? `<div class="aviso ${mensagem.tipo || ""} nao-imprimir" style="margin-bottom:16px">${esc(mensagem.texto)}</div>` : "";
    mensagem = null;
    const telas = { inicio: telaInicio, E1: telaE1, E2: telaE2, E3: telaE3, E4: telaE4, E5: telaE5, rel: telaRelatorio };
    alvo.innerHTML = msg + telas[etapa](D);
    document.title = "TRIA-PME" + (etapa !== "inicio" ? " · " + ETAPAS.find(e => e.id === etapa).nome : "");
  }

  function cabecalho(n, titulo, texto) {
    return `<div class="cab-etapa"><span class="rotulo">${n}</span><h1>${titulo}</h1><p class="sutil">${texto}</p></div>`;
  }
  function rodape(voltar, avancar, rotuloAvancar, bloqueio) {
    return `<div class="rodape-etapa">
      <div>${voltar ? `<button type="button" class="btn" data-ir="${voltar}">← Voltar</button>` : ""}</div>
      <div class="linha-flex">${bloqueio ? `<span class="bloqueio">${bloqueio}</span>` : ""}
      ${avancar ? `<button type="button" class="btn primario" data-acao="avancar" data-alvo="${avancar}" ${bloqueio ? "disabled" : ""}>${rotuloAvancar} →</button>` : ""}</div></div>`;
  }

  /* ============================================================ início */
  function telaInicio() {
    const salvo = lerLocal();
    const inv = N.invariantes(K);
    return `
    <div class="abertura">
      <div class="pilha" style="gap:18px">
        <span class="rotulo">Triagem de riscos de IA para pequenas e médias empresas</span>
        <h1>Descubra quais riscos de IA sua empresa corre e o que fazer primeiro.</h1>
        <p class="lead">Responda perguntas sobre práticas que existem ou não existem na sua empresa. Ao final, você recebe um registro de riscos priorizado, com um responsável por risco e um plano de ações ordenado da mais simples para a mais trabalhosa.</p>
        <div class="linha-flex">
          <button type="button" class="btn primario" data-acao="nova">Iniciar nova triagem</button>
          <button type="button" class="btn" data-acao="demo">Abrir caso demonstrativo</button>
          <label class="btn" for="arquivo-importar" style="display:inline-block">Retomar de um arquivo .json</label>
          <input type="file" id="arquivo-importar" accept=".json,application/json" hidden>
        </div>
        ${salvo ? `<div class="aviso info">Há uma triagem salva neste navegador (${esc(salvo.S.perfil.organizacao || "sem nome")}). <button type="button" class="btn mini" data-acao="retomar-local">Retomar</button> <button type="button" class="btn mini perigo" data-acao="apagar-local">Apagar</button></div>` : ""}
        <p class="pequeno sutil">Tudo roda no seu navegador. Nenhuma resposta é enviada para servidor algum; o resultado só sai daqui se você exportar o arquivo.</p>
        <div class="bloco tutorial">
          <h2>Como usar, em seis passos</h2>
          <ol>
            <li><b>Contexto (E1).</b> Informe setor, porte, tipos de dado e as ferramentas de IA em uso. Ao final, confira o quadro “O que suas respostas ativaram”: ele mostra quais temas de risco entram ou ficam de fora da triagem.</li>
            <li><b>Identificação (E2).</b> Responda Sim, Não ou Não sei a cada pergunta. As perguntas pedem fatos que poderiam ser mostrados, como um documento ou uma configuração. “Não sei” conta como risco.</li>
            <li><b>Priorização (E3).</b> Para cada risco encontrado, escolha até onde chegaria a consequência e diga se o problema já aconteceu. Algumas respostas já vêm definidas pelo seu perfil ou pela E2. O escore só aparece depois que todos os riscos forem avaliados.</li>
            <li><b>Responsáveis (E4).</b> Escreva, para cada risco acima do limiar, o nome e o cargo de uma pessoa que vai acompanhar o plano.</li>
            <li><b>Plano (E5).</b> Revise as ações sugeridas. Você pode mudar o prazo ou remover uma ação, explicando o motivo.</li>
            <li><b>Relatório.</b> Exporte em PDF para circular na empresa, em CSV para acompanhar o plano, e em JSON para retomar depois.</li>
          </ol>
          <p class="pequeno sutil">Tempo esperado: até 40 minutos. Para ver o resultado antes de começar, abra o caso demonstrativo: uma clínica odontológica fictícia com todas as respostas preenchidas.</p>
        </div>
      </div>
      <div class="pilha">
        <div class="bloco">
          <span class="rotulo">O protocolo</span>
          <ol class="protocolo">
            <li><span class="e">E1</span><div><h3>Caracterização do contexto</h3><p class="pequeno sutil">O perfil decide quais perguntas se aplicam e quais agravantes entram no cálculo.</p></div></li>
            <li><span class="e">E2</span><div><h3>Identificação</h3><p class="pequeno sutil">${K.itens.itens.length} perguntas verificáveis, ligadas a ${K.taxonomia.categorias.length} categorias de risco.</p></div></li>
            <li><span class="e">E3</span><div><h3>Priorização</h3><p class="pequeno sutil">Impacto × frequência, ampliado por agravantes do contexto, com impacto mínimo definido pelo perfil. Limiar de ação em ${num(K.regras.limiarDeAcaoObrigatoria)}.</p></div></li>
            <li><span class="e">E4</span><div><h3>Atribuição de responsáveis</h3><p class="pequeno sutil">Uma pessoa por risco, não uma área.</p></div></li>
            <li><span class="e">E5</span><div><h3>Plano de mitigação</h3><p class="pequeno sutil">${K.controles.controles.length} ações possíveis, ordenadas por esforço crescente.</p></div></li>
          </ol>
        </div>
        <details class="bloco">
          <summary><b>Sobre o conteúdo desta versão</b></summary>
          <p class="pequeno sutil">Perfil v${esc(K.perfil.versao)} · taxonomia v${esc(K.taxonomia.versao)} · itens v${esc(K.itens.versao)} · controles v${esc(K.controles.versao)} · regras v${esc(K.regras.versao)}. Fontes: AI Risk Repository, NIST AI RMF 1.0, ISO/IEC 23894:2023.</p>
          <table><tbody>${inv.map(i => `<tr><td>${i.ok ? '<span class="chip esf-baixo">OK</span>' : '<span class="chip sev-critico">falha</span>'}</td><td>${esc(i.nome)}</td><td class="sutil pequeno">${esc(i.detalhe)}</td></tr>`).join("")}</tbody></table>
        </details>
      </div>
    </div>`;
  }

  /* ============================================================ E1 */
  function telaE1(D) {
    const p = S.perfil;
    const sn = (campo, texto, ajuda) => `
      <div class="pergunta-sn"><div><div>${texto}</div>${ajuda ? `<div class="pequeno sutil">${ajuda}</div>` : ""}</div>
      <div class="seg" role="group" aria-label="${esc(texto)}">
        <button type="button" data-bool="${campo}" data-v="true" aria-pressed="${p[campo] === true}">Sim</button>
        <button type="button" data-bool="${campo}" data-v="false" aria-pressed="${p[campo] === false}">Não</button>
      </div></div>`;
    const pend = pendenciasE1();
    return cabecalho("Etapa E1", "Caracterização do contexto", "Fatos sobre a empresa e o uso de IA. As respostas aqui definem quais perguntas aparecem na próxima etapa e quais agravantes entram no cálculo.") + `
    <div class="grade"><div>
      <section class="bloco">
        <h2>A organização</h2>
        <div class="campos-2">
          <label class="campo" for="f-org">Nome da organização <input type="text" id="f-org" data-campo="organizacao" value="${esc(p.organizacao)}" placeholder="Opcional"></label>
          <label class="campo" for="f-porte">Porte
            <select id="f-porte" data-campo="porte"><option value="">Escolha…</option>${PORTES.map(o => `<option value="${o[0]}" ${p.porte === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></label>
          <label class="campo" for="f-setor">Setor de atuação
            <select id="f-setor" data-campo="setor"><option value="">Escolha…</option>${SETORES.map(o => `<option value="${o[0]}" ${p.setor === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></label>
        </div>
      </section>
      <section class="bloco">
        <h2>Que tipo de informação a empresa trata?</h2>
        <p class="pequeno sutil">Marque tudo o que a empresa guarda ou manipula no dia a dia, mesmo que não passe pela IA.</p>
        <div class="opcoes">${DADOS.map(d => `<label class="opcao ${p.naturezaDosDados.includes(d[0]) ? "marcada" : ""}" for="d-${d[0]}"><input type="checkbox" id="d-${d[0]}" data-dado="${d[0]}" ${p.naturezaDosDados.includes(d[0]) ? "checked" : ""}><span>${d[1]}</span></label>`).join("")}</div>
      </section>
      <section class="bloco">
        <h2>Como a empresa usa IA</h2>
        <div class="opcoes">${MODOS.map(m => `<label class="opcao ${p.modoDeAdocao === m[0] ? "marcada" : ""}" for="m-${m[0]}"><input type="radio" name="modo" id="m-${m[0]}" data-modo="${m[0]}" ${p.modoDeAdocao === m[0] ? "checked" : ""}><span><b>${m[1]}</b><br><span class="pequeno sutil">${m[2]}</span></span></label>`).join("")}</div>
        <h3 style="margin-top:6px">Ferramentas de IA em uso</h3>
        <div class="pilha" id="lista-sistemas">${p.sistemasDeIA.map((s, i) => linhaSistema(s, i)).join("")}</div>
        <div><button type="button" class="btn mini" data-acao="add-sistema">+ Adicionar ferramenta</button></div>
      </section>
      <section class="bloco">
        <h2>Até onde a IA chega</h2>
        <div>
          ${ALCANCE.map(q => sn(q.campo, esc(q.texto), esc(q.ajuda))).join("")}
        </div>
      </section>
      <section class="bloco">
        <h2>Pessoas-chave <span class="pequeno sutil">(opcional)</span></h2>
        <p class="pequeno sutil">Preencha só os papéis que existem. Os nomes servem para sugerir quem executa cada ação do plano e para agilizar a E4. Não é preciso ter comitê nem área de risco.</p>
        <div class="campos-2">${PAPEIS.map(x => `<label class="campo" for="pp-${x[0]}">${x[1]}<input type="text" id="pp-${x[0]}" data-pessoa="${x[0]}" value="${esc(p.pessoas[x[0]] || "")}" placeholder="Nome da pessoa"></label>`).join("")}</div>
      </section>
      ${quadroPerfil(D)}
      ${rodape("inicio", "E2", "Continuar para a identificação", pend.length ? "Falta: " + pend.join(", ") + "." : "")}
    </div>
    <aside class="lateral" id="lateral-e1">${lateralE1(D)}</aside></div>`;
  }
  /* PBL8 (melhoria M7): mostra ao usuário o que o perfil derivado ativou ou desligou, para que um erro de
   * interpretação na E1 (como o do teste-piloto do PBL7) fique visível antes da E2. */
  function origemDoCampo(campo) {
    if (ALCANCE.some(q => q.campo === campo)) return [campo];
    const d = K.perfil.derivacoes.find(x => x.campo === campo);
    if (d && d.perguntasDeOrigem) return d.perguntasDeOrigem.slice(0, 1);
    return [campo];
  }
  function fraseResposta(campo) {
    const q = ALCANCE.find(x => x.campo === campo), v = S.perfil[campo];
    if (q) return v === true ? q.seSim : v === false ? q.seNao : "";
    if (campo === "modoDeAdocao") { const m = MODOS.find(x => x[0] === S.perfil.modoDeAdocao); return m ? "a empresa usa IA na forma “" + m[1].toLowerCase() + "”" : ""; }
    return campo;
  }
  function motivoForaDoPerfil(cat, pm) {
    const motivos = new Set();
    K.itens.itens.filter(i => i.categoria === cat).forEach(i => {
      const cond = i.condicaoDeAplicabilidade || {};
      Object.keys(cond).forEach(k => { if (!N.aplicavel({ [k]: cond[k] }, pm)) origemDoCampo(k).forEach(o => motivos.add(fraseResposta(o))); });
    });
    return Array.from(motivos).filter(Boolean);
  }
  function quadroPerfil(D) {
    const pend = pendenciasE1();
    const respondidas = ALCANCE.filter(q => S.perfil[q.campo] === true || S.perfil[q.campo] === false);
    if (!S.perfil.modoDeAdocao || !respondidas.length) return "";
    return `<section class="bloco quadro-perfil" id="quadro-perfil">
      <span class="rotulo">Confira antes de continuar</span>
      <h2>O que suas respostas ativaram</h2>
      <p class="pequeno">Pelo que você respondeu:</p>
      <ul class="pequeno">${respondidas.map(q => `<li>${esc(fraseResposta(q.campo))};</li>`).join("")}</ul>
      <p class="pequeno">Agravantes que entram no cálculo: ${D.mods.length ? D.mods.map(m => `<span class="chip">${esc(modRotulo(m))}</span>`).join(" ") : "<b>nenhum</b>"}</p>
      ${D.e2.foraDoPerfil.length ? `<p class="pequeno"><b>Ficam fora da triagem</b> (nenhuma pergunta deste tema se aplica ao seu perfil):</p>
        <ul class="pequeno">${D.e2.foraDoPerfil.map(c => { const m = motivoForaDoPerfil(c, D.pm); return `<li><span class="cod">${c}</span> ${esc(IDX.cats[c].nome)}${m.length ? " — porque " + esc(m.join(" e ")) : ""}.</li>`; }).join("")}</ul>` :
        `<p class="pequeno">Todos os ${K.taxonomia.categorias.length} temas de risco entram na triagem.</p>`}
      <p class="pequeno sutil">Se algo aqui não corresponde à realidade da empresa, corrija a resposta acima. ${pend.length ? "" : "Ao continuar, este quadro fica registrado na sessão."}</p>
    </section>`;
  }
  function linhaSistema(s, i) {
    return `<div class="bloco" style="padding:12px;background:var(--superficie-2)">
      <div class="campos-2">
        <label class="campo" for="s-nome-${i}">Ferramenta<input type="text" id="s-nome-${i}" data-sis="${i}" data-k="nome" value="${esc(s.nome)}" placeholder="Ex.: assistente de redação"></label>
        <label class="campo" for="s-fin-${i}">Para que é usada<input type="text" id="s-fin-${i}" data-sis="${i}" data-k="finalidade" value="${esc(s.finalidade)}" placeholder="Ex.: responder clientes"></label>
        <label class="campo" for="s-for-${i}">Fornecedor<input type="text" id="s-for-${i}" data-sis="${i}" data-k="fornecedor" value="${esc(s.fornecedor)}" placeholder="Opcional"></label>
        <label class="campo" for="s-san-${i}">Aprovada pela direção?
          <select id="s-san-${i}" data-sis="${i}" data-k="sancionado"><option value="">Escolha…</option>${RESP.map(r => `<option value="${r[0]}" ${s.sancionado === r[0] ? "selected" : ""}>${r[1]}</option>`).join("")}</select></label>
      </div>
      ${S.perfil.sistemasDeIA.length > 1 ? `<div><button type="button" class="btn mini perigo" data-acao="rm-sistema" data-i="${i}">Remover</button></div>` : ""}
    </div>`;
  }
  function lateralE1(D) {
    D = D || derivar();
    const total = K.itens.itens.length, aplic = D.e2.aplicaveis.length;
    const pronto = !!S.perfil.modoDeAdocao;
    return `
      <div class="painel">
        <span class="rotulo">Agravantes do contexto</span>
        <p class="pequeno sutil">Derivados automaticamente do perfil. Ampliam o escore dos riscos sobre os quais incidem.</p>
        ${K.regras.modificadores.map(m => {
          const on = D.mods.includes(m.codigo);
          return `<div class="mod ${on ? "on" : "off"}"><span class="led"></span><span>${esc(m.rotulo)}</span><span class="mono pequeno">+${num(m.peso)}</span></div>`;
        }).join("")}
        <p class="pequeno">Fator máximo neste perfil: <b class="mono">${num(1 + D.mods.reduce((s, c) => s + K.regras.modificadores.find(m => m.codigo === c).peso, 0))}</b></p>
      </div>
      <div class="painel">
        <span class="rotulo">Perguntas que se aplicam</span>
        <div><span class="grande">${pronto ? aplic : "—"}</span> <span class="sutil">de ${total}</span></div>
        <p class="pequeno sutil">${pronto ? `Ficam de fora as perguntas que não fazem sentido para este perfil.` : "Escolha como a empresa usa IA para calcular."}</p>
      </div>`;
  }

  /* ============================================================ E2 */
  function gruposE2(D) {
    const aplic = new Set(D.e2.aplicaveis);
    const grupos = [];
    K.taxonomia.categorias.forEach(c => {
      const its = K.itens.itens.filter(i => i.categoria === c.codigo && aplic.has(i.codigo));
      if (its.length) grupos.push({ cat: c, itens: its });
    });
    return grupos;
  }
  function telaE2(D) {
    const grupos = gruposE2(D);
    const total = D.e2.aplicaveis.length, feitas = total - D.e2.pendentes.length;
    if (verResumoE2 && !D.e2.pendentes.length) return resumoE2(D);
    if (grupoAtual >= grupos.length) grupoAtual = 0;
    const g = grupos[grupoAtual];
    const completo = gr => gr.itens.every(i => S.respostas[i.codigo]);
    return cabecalho("Etapa E2", "Identificação de riscos", "Responda pelo que existe hoje, não pelo que a empresa pretende fazer. Se você não sabe, marque “Não sei”: o desconhecimento também é um sinal de risco.") + `
    <div class="bloco">
      <div class="linha-flex entre"><span class="pequeno"><b class="mono">${feitas}</b> de <b class="mono">${total}</b> respondidas</span><span class="pequeno sutil">Tema ${grupoAtual + 1} de ${grupos.length}</span></div>
      <div class="progresso"><i style="width:${total ? (100 * feitas / total) : 0}%"></i></div>
      <div class="grupos" role="tablist">${grupos.map((gr, n) => `<button type="button" role="tab" data-grupo="${n}" class="${completo(gr) ? "completo" : ""}" aria-current="${n === grupoAtual}" title="${esc(gr.cat.nome)}">${gr.cat.codigo}</button>`).join("")}</div>
    </div>
    <section class="bloco">
      <div class="pilha" style="gap:4px"><span class="rotulo">${g.cat.codigo} · tema</span><h2>${esc(g.cat.nome)}</h2><p class="pequeno sutil">${esc(g.cat.exemploConcreto)}</p></div>
      <div>${g.itens.map(i => {
        const r = S.respostas[i.codigo] || {};
        return `<div class="item">
          <div class="linha-flex"><span class="cod">${i.codigo}</span><span class="chip">evidência: ${esc(i.tipoDeEvidencia)}</span></div>
          <p class="enunciado">${esc(i.enunciado)}</p>
          <div class="seg" role="group" aria-label="Resposta ${i.codigo}">${RESP.map(o => `<button type="button" data-resp="${i.codigo}" data-v="${o[0]}" aria-pressed="${r.valor === o[0]}">${o[1]}</button>`).join("")}</div>
          <details ${r.evidencia ? "open" : ""}><summary>Anotar onde está a evidência (opcional)</summary>
            <textarea id="ev-${i.codigo}" data-ev="${i.codigo}" placeholder="Ex.: documento na pasta compartilhada, captura da configuração…">${esc(r.evidencia || "")}</textarea></details>
        </div>`;
      }).join("")}</div>
      <div class="linha-flex entre">
        <button type="button" class="btn" data-grupo="${grupoAtual - 1}" ${grupoAtual === 0 ? "disabled" : ""}>← Tema anterior</button>
        ${grupoAtual < grupos.length - 1 ? `<button type="button" class="btn" data-grupo="${grupoAtual + 1}">Próximo tema →</button>` : ""}
      </div>
    </section>
    <div class="rodape-etapa">
      <button type="button" class="btn" data-ir="E1">← Revisar contexto</button>
      <div class="linha-flex">${D.e2.pendentes.length ? `<span class="bloqueio">Faltam ${D.e2.pendentes.length} resposta(s).</span>` : ""}
      <button type="button" class="btn primario" data-acao="resumo-e2" ${D.e2.pendentes.length ? "disabled" : ""}>Ver riscos identificados →</button></div>
    </div>`;
  }
  function resumoE2(D) {
    const e2 = D.e2;
    const linhaCat = c => {
      const ev = e2.evidencias[c] || [];
      return `<tr><td><span class="cod">${c}</span></td><td>${esc(IDX.cats[c].nome)}</td><td class="pequeno">${ev.map(m => `<span class="${m.instancia ? "" : "sutil"}">${m.item} ${RESP.find(r => r[0] === m.resposta)[1].toLowerCase()}${m.instancia ? " ●" : ""}</span>`).join(" · ")}</td></tr>`;
    };
    return cabecalho("Etapa E2", "Riscos identificados", "Um risco entra no registro quando pelo menos uma resposta indica exposição. Uma categoria só sai quando todas as respostas dela vieram limpas.") + `
    <div class="kpis">
      <div class="kpi"><span class="rotulo">Riscos identificados</span><span class="grande">${e2.riscos.length}</span></div>
      <div class="kpi"><span class="rotulo">Categorias limpas</span><span class="grande">${e2.excluidas.length}</span></div>
      <div class="kpi"><span class="rotulo">Fora do perfil</span><span class="grande">${e2.foraDoPerfil.length}</span></div>
      <div class="kpi"><span class="rotulo">Perguntas respondidas</span><span class="grande">${e2.aplicaveis.length}</span></div>
    </div>
    <section class="bloco"><h2>Entram no registro</h2>
      ${e2.riscos.length ? `<div class="rolagem"><table><thead><tr><th>Cód.</th><th>Risco</th><th>Respostas (● indica exposição)</th></tr></thead><tbody>${e2.riscos.map(linhaCat).join("")}</tbody></table></div>` : `<p class="sutil">Nenhuma resposta indicou exposição.</p>`}
    </section>
    ${e2.excluidas.length ? `<section class="bloco"><h2>Saem do registro</h2><p class="pequeno sutil">Todas as perguntas aplicáveis destas categorias foram respondidas sem indicar exposição.</p><div class="rolagem"><table><tbody>${e2.excluidas.map(linhaCat).join("")}</tbody></table></div></section>` : ""}
    ${e2.foraDoPerfil.length ? `<section class="bloco"><h2>Não se aplicam a este perfil</h2><p class="pequeno">${e2.foraDoPerfil.map(c => `<span class="cod">${c}</span> ${esc(IDX.cats[c].nome)}`).join("<br>")}</p></section>` : ""}
    <div class="rodape-etapa">
      <button type="button" class="btn" data-acao="voltar-perguntas">← Voltar às perguntas</button>
      <button type="button" class="btn primario" data-acao="avancar" data-alvo="E3">Continuar para a priorização →</button>
    </div>`;
  }

  /* ============================================================ E3 */
  function telaE3(D) {
    const riscos = D.e2.riscos;
    if (!riscos.length) {
      return cabecalho("Etapa E3", "Priorização", "Nenhum risco foi identificado em E2.") + `<div class="aviso ok">Todas as respostas vieram sem indicar exposição. Não há o que priorizar; o relatório registrará apenas o monitoramento periódico.</div>` + rodape("E2", "E5", "Continuar", "");
    }
    const faltam = D.naoAvaliados.length;
    if (verRegistroE3 && !faltam) return registroE3(D);
    const escI = K.regras.escalas.impacto, escF = K.regras.escalas.frequencia;
    const cartao = (c, n) => {
      const cat = IDX.cats[c], a = S.avaliacoes[c] || {};
      const ev = (D.e2.evidencias[c] || []).filter(m => m.instancia).map(m => `${m.item}: ${esc(IDX.itens[m.item].enunciado)} <b>(${RESP.find(x => x[0] === m.resposta)[1]})</b>`);
      const it = N.intensidade(D.e2, c);
      const piso = N.pisoDeImpacto(K, c, D.pm, D.mods, D.rs);
      const fE2 = D.fE2[c];
      const avaliado = !D.naoAvaliados.includes(c);
      const blocoI = `<div><div class="rotulo" style="margin-bottom:6px">${esc(escI.pergunta)}</div>
        ${piso.valor > 1 ? `<p class="pequeno nota-piso">Impacto mínimo <b>${piso.valor}</b> para este risco, porque ${esc(piso.regras.filter(r => r.piso === piso.valor).map(r => r.motivo).join(" e "))}. Você pode escolher um impacto maior, não menor.</p>` : ""}
        ${escI.opcoes.map(x => { const bloq = x.valor < piso.valor, sel = a.I && Math.max(a.I, piso.valor) === x.valor; return `<label class="ancora ${sel ? "marcada" : ""} ${bloq ? "bloqueada" : ""}"><input type="radio" name="I-${c}" data-aval="${c}" data-tipo="I" value="${x.valor}" ${sel ? "checked" : ""} ${bloq ? "disabled" : ""}><span class="v">${x.valor}</span><span>${esc(x.ancora)}</span></label>`; }).join("")}</div>`;
      const blocoF = `<div><div class="rotulo" style="margin-bottom:6px">${esc(escF.pergunta)}</div>
        <p class="pequeno evento"><b>O evento:</b> ${esc(cat.eventoDeOcorrencia)}.</p>
        ${fE2 ? `<p class="pequeno nota-piso">Já respondido na E2 (${fE2.item}: <b>${esc(RESP.find(x => x[0] === fE2.resposta)[1])}</b>). Para mudar, revise a resposta na E2.</p>` : ""}
        ${escF.opcoes.map(x => { const sel = fE2 ? fE2.codigo === x.codigo : a.F === x.codigo; return `<label class="ancora ${sel ? "marcada" : ""} ${fE2 && !sel ? "bloqueada" : ""}"><input type="radio" name="F-${c}" data-aval="${c}" data-tipo="F" value="${x.codigo}" ${sel ? "checked" : ""} ${fE2 ? "disabled" : ""}><span class="v">${sel ? "✓" : ""}</span><span>${esc(x.rotulo)}</span></label>`; }).join("")}</div>`;
      return `<section class="bloco" id="risco-${c}">
        <div class="linha-flex entre"><div class="linha-flex"><span class="cod">${c}</span><h2>${esc(cat.nome)}</h2></div><span class="chip">${avaliado ? "avaliado" : "a avaliar"} · ${n + 1} de ${riscos.length}</span></div>
        <p class="sutil">${esc(cat.definicao)}</p>
        <p class="pequeno intensidade">Na E2, <b>${it.expostas} de ${it.total}</b> pergunta(s) deste tema indicaram exposição.</p>
        <details><summary class="pequeno">Quais respostas da E2 trouxeram este risco</summary><ul class="pequeno">${ev.map(e => `<li>${e}</li>`).join("")}</ul></details>
        <div class="ancoras">${blocoI}${blocoF}</div>
      </section>`;
    };
    const avaliados = riscos.length - faltam;
    return cabecalho("Etapa E3", "Priorização", `Para cada um dos ${riscos.length} riscos, diga até onde chegaria a consequência e se o problema já aconteceu. O escore e o destino de cada risco (plano ou monitoramento) só aparecem depois que todos forem avaliados.`) + `
      <div class="bloco"><div class="linha-flex entre"><span class="pequeno"><b class="mono">${avaliados}</b> de <b class="mono">${riscos.length}</b> riscos avaliados</span></div>
        <div class="progresso"><i style="width:${100 * avaliados / riscos.length}%"></i></div></div>
      ${riscos.map(cartao).join("")}
      <div class="rodape-etapa">
        <button type="button" class="btn" data-ir="E2">← Voltar</button>
        <div class="linha-flex">${faltam ? `<span class="bloqueio">Falta avaliar ${faltam} risco(s).</span>` : ""}
        <button type="button" class="btn primario" data-acao="registro-e3" ${faltam ? "disabled" : ""}>Ver registro de riscos →</button></div>
      </div>`;
  }
  function registroE3(D) {
    const prox = D.acima.length ? "E4" : "E5";
    return cabecalho("Etapa E3", "Registro de riscos", `Riscos com escore ${num(K.regras.limiarDeAcaoObrigatoria)} ou mais seguem para o plano; os demais ficam em monitoramento.`) + `
      <section class="bloco">${tabelaRegistro(D, false)}</section>
      <div class="rodape-etapa">
        <button type="button" class="btn" data-acao="voltar-avaliacoes">← Rever as avaliações</button>
        <button type="button" class="btn primario" data-acao="avancar" data-alvo="${prox}">${prox === "E4" ? "Atribuir responsáveis" : "Ver plano"} →</button>
      </div>`;
  }
  function tabelaRegistro(D, comResp) {
    const lim = K.regras.limiarDeAcaoObrigatoria;
    const temPiso = D.registro.some(r => r.I > r.Ideclarado), temE2 = D.registro.some(r => r.frequenciaPelaE2);
    const linhas = D.registro.map((r, n) => {
      const ultimoAcima = r.acima && !(D.registro[n + 1] && D.registro[n + 1].acima);
      return `<tr class="${ultimoAcima && n < D.registro.length - 1 ? "limiar" : ""}"><td><span class="cod">${r.categoria}</span></td><td>${esc(r.nome)}</td>
        <td class="num">${r.I}${r.I > r.Ideclarado ? "<sup>p</sup>" : ""}</td><td>${rotuloF(r.F)}${r.frequenciaPelaE2 ? "<sup>e</sup>" : ""}</td><td class="num">${num(r.fator)}</td><td class="num"><b>${num(r.escore)}</b></td><td>${chipFaixa(r)}</td>
        ${comResp ? `<td>${r.acima ? esc(respDe(r.categoria) || "—") : '<span class="sutil">monitoramento</span>'}</td>` : `<td>${r.acima ? "plano" : '<span class="sutil">monitorar</span>'}</td>`}</tr>`;
    }).join("");
    const fs = K.regras.escalas.frequencia.opcoes.map(o => rotuloF(o.codigo) + " = " + o.valor).join("; ");
    return `<div class="rolagem"><table><thead><tr><th>Cód.</th><th>Risco</th><th class="num">Impacto</th><th>Já aconteceu?</th><th class="num">Fator</th><th class="num">Escore</th><th>Faixa</th><th>${comResp ? "Responsável" : "Destino"}</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <p class="pequeno sutil"><span class="limiar-rot">- - - limiar ${num(lim)}</span> · Crítico ≥ 24 · Alto ≥ 14 · Moderado ≥ 7 · Baixo &lt; 7 · escore = impacto × frequência (${fs}) × (1 + agravantes)${temPiso ? " · <sup>p</sup> impacto elevado ao mínimo definido pelo perfil" : ""}${temE2 ? " · <sup>e</sup> frequência definida pela resposta da E2" : ""}</p>`;
  }

  /* ============================================================ E4 */
  /* PBL8 (melhoria M5): responsável com nome e cargo livres, em vez de um de quatro papéis fixos. */
  function pessoasConhecidas() {
    const m = new Map();
    PAPEIS.forEach(x => { const n = (S.perfil.pessoas[x[0]] || "").trim(); if (n && !m.has(n)) m.set(n, x[1].replace(/ \(.*\)$/, "")); });
    Object.values(S.responsaveis).forEach(r => { const n = ((r && r.nome) || "").trim(); if (n && !m.has(n)) m.set(n, (r.cargo || "").trim()); });
    return m;
  }
  function telaE4(D) {
    const faltam = D.acima.filter(r => !responsavelValido(r.categoria)).length;
    const conhecidas = pessoasConhecidas();
    return cabecalho("Etapa E4", "Atribuição de responsáveis", `Cada um dos ${D.acima.length} riscos acima do limiar precisa de uma pessoa, com nome e cargo. Ela acompanha o plano daquele risco; não precisa executar todas as ações sozinha.`) + `
      <section class="bloco"><div class="rolagem"><table><thead><tr><th>Cód.</th><th>Risco</th><th class="num">Escore</th><th>Responsável</th></tr></thead><tbody>
      ${D.acima.map(r => { const v = S.responsaveis[r.categoria] || {}; return `<tr><td><span class="cod">${r.categoria}</span></td><td>${esc(r.nome)}<br>${chipFaixa(r)}</td><td class="num"><b>${num(r.escore)}</b></td>
        <td style="min-width:260px"><div class="campos-2">
          <label class="campo" for="respn-${r.categoria}"><span class="sutil pequeno">Nome</span><input type="text" id="respn-${r.categoria}" list="pessoas-conhecidas" data-resp-cat="${r.categoria}" data-k="nome" value="${esc(v.nome || "")}" placeholder="Ex.: Renata Lima"></label>
          <label class="campo" for="respc-${r.categoria}"><span class="sutil pequeno">Cargo ou função</span><input type="text" id="respc-${r.categoria}" data-resp-cat="${r.categoria}" data-k="cargo" value="${esc(v.cargo || "")}" placeholder="Ex.: sócia, gerente financeiro"></label>
        </div></td></tr>`; }).join("")}
      </tbody></table></div>
      <datalist id="pessoas-conhecidas">${Array.from(conhecidas.keys()).map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <p class="pequeno sutil">Escreva o nome de uma pessoa, não de uma área. Os nomes cadastrados na E1 e os já usados aqui aparecem como sugestão.</p></section>
      ${rodape("E3", "E5", "Gerar o plano", faltam ? `Falta indicar nome e cargo de ${faltam} responsável(is).` : "")}`;
  }
  function definirResponsavel(t, registrar) {
    const cat = t.dataset.respCat, r = S.responsaveis[cat] = Object.assign({ nome: "", cargo: "" }, S.responsaveis[cat]);
    r[t.dataset.k] = t.value;
    /* nome escolhido entre os conhecidos: sugere o cargo, se ainda vazio */
    if (t.dataset.k === "nome" && !r.cargo.trim()) { const cg = pessoasConhecidas().get(t.value.trim()); if (cg) { r.cargo = cg; const el = document.getElementById("respc-" + cat); if (el) el.value = cg; } }
    if (registrar) trilha("responsável definido", cat + " → " + (respDe(cat) || "—"));
    salvarLocal(); atualizarRodapeE4();
  }
  function atualizarRodapeE4() {
    if (etapa !== "E4") return;
    const D = derivar(), faltam = D.acima.filter(r => !responsavelValido(r.categoria)).length;
    const rod = $(".rodape-etapa"); if (!rod) return;
    const bt = rod.querySelector('[data-acao="avancar"]'); let bl = rod.querySelector(".bloqueio");
    bt.disabled = !!faltam;
    if (!bl && faltam) { bl = document.createElement("span"); bl.className = "bloqueio"; bt.before(bl); }
    if (bl) bl.textContent = faltam ? `Falta indicar nome e cargo de ${faltam} responsável(is).` : "";
    $("#trilho").querySelectorAll("button").forEach(btn => { const id = btn.dataset.ir; btn.disabled = !(id === "inicio" || liberada(id, D)); });
  }

  /* ============================================================ E5 */
  function planoEfetivo(D) {
    // plano derivado pelo núcleo + ajustes do gestor (remoções e horizontes), preservando a trilha
    return D.acima.map(r => ({
      risco: r,
      controles: D.planoBase[r.categoria].map((cod, n) => {
        const ch = r.categoria + "|" + cod, c = IDX.ctrls[cod];
        const executor = (S.perfil.pessoas[c.papelSugerido] || "").trim()
          ? pessoaDe(c.papelSugerido)
          : (respDe(r.categoria) ? respDe(r.categoria) + " · papel sugerido: " + PAPEL_CURTO[c.papelSugerido] : "—");
        return { ordem: n + 1, chave: ch, c, executor, horizonte: S.ajustes.horizontes[ch] || c.horizonte,
                 horizonteAlterado: !!S.ajustes.horizontes[ch], removido: S.ajustes.removidos[ch] !== undefined, justificativa: S.ajustes.removidos[ch] || "" };
      })
    }));
  }
  function acoesImediatas(plano) {
    const vistos = new Map();
    plano.forEach(p => p.controles.forEach(x => { if (!x.removido && x.c.esforco === "baixo" && x.horizonte === "imediato" && !vistos.has(x.c.codigo)) vistos.set(x.c.codigo, x); }));
    return Array.from(vistos.values());
  }
  function telaE5(D) {
    const plano = planoEfetivo(D);
    const monitor = D.registro.filter(r => !r.acima);
    const imed = acoesImediatas(plano);
    const distintos = new Set(); plano.forEach(p => p.controles.forEach(x => { if (!x.removido) distintos.add(x.c.codigo); }));
    const blocoRisco = p => {
      const ativos = p.controles.filter(x => !x.removido).length;
      return `<section class="bloco faixa-borda ${p.risco.faixa}">
        <div class="linha-flex entre"><div class="linha-flex"><span class="cod">${p.risco.categoria}</span><h2>${esc(p.risco.nome)}</h2></div><div class="linha-flex">${chipFaixa(p.risco)}<span class="chip mono">${num(p.risco.escore)}</span></div></div>
        <p class="pequeno">Responsável: <b>${esc(respDe(p.risco.categoria))}</b></p>
        <div>${p.controles.map(x => {
          const editando = removendo === x.chave;
          return `<div class="controle ${x.removido ? "removido" : ""}">
            <span class="ordem">${x.ordem}</span>
            <div class="pilha" style="gap:6px">
              <p class="desc">${esc(x.c.descricao)}</p>
              <div class="meta"><span class="cod">${x.c.codigo}</span><span class="chip esf-${x.c.esforco}">esforço ${ESF[x.c.esforco]}</span>
                <label for="h-${x.chave}">prazo <select id="h-${x.chave}" data-horiz="${x.chave}" ${x.removido ? "disabled" : ""}>${Object.keys(HORIZ).map(h => `<option value="${h}" ${x.horizonte === h ? "selected" : ""}>${HORIZ[h]}</option>`).join("")}</select></label>
                <span>${TIPO[x.c.tipo]}</span><span>executa: ${esc(x.executor)}</span></div>
              ${x.removido ? `<p class="pequeno"><b>Removida.</b> Motivo: ${esc(x.justificativa)} <button type="button" class="btn mini" data-acao="restaurar" data-ch="${x.chave}">Restaurar</button></p>` :
                editando ? `<div class="justif"><label class="campo" for="just-${x.chave}">Por que esta ação não será feita?<textarea id="just-${x.chave}" placeholder="O motivo fica registrado no relatório."></textarea></label>
                  <div class="linha-flex"><button type="button" class="btn mini perigo" data-acao="confirmar-remocao" data-ch="${x.chave}">Remover com este motivo</button><button type="button" class="btn mini" data-acao="cancelar-remocao">Cancelar</button></div></div>` :
                `<div>${ativos > 1 ? `<button type="button" class="btn mini" data-acao="remover" data-ch="${x.chave}">Remover ação…</button>` : `<span class="pequeno sutil">Todo risco do plano precisa manter ao menos uma ação.</span>`}</div>`}
            </div></div>`;
        }).join("")}</div></section>`;
    };
    return cabecalho("Etapa E5", "Plano de mitigação", "As ações vêm do catálogo, filtradas pelo seu perfil e ordenadas do menor para o maior esforço. Você pode mudar o prazo ou remover uma ação; toda mudança fica registrada.") + `
      ${plano.length ? `<div class="kpis" style="margin-bottom:16px">
        <div class="kpi"><span class="rotulo">Riscos com plano</span><span class="grande">${plano.length}</span></div>
        <div class="kpi"><span class="rotulo">Ações distintas</span><span class="grande">${distintos.size}</span></div>
        <div class="kpi"><span class="rotulo">Para começar já</span><span class="grande">${imed.length}</span><span class="pequeno sutil">esforço baixo, prazo imediato</span></div>
        <div class="kpi"><span class="rotulo">Em monitoramento</span><span class="grande">${monitor.length}</span></div>
      </div>${plano.map(blocoRisco).join("")}` : `<div class="aviso ok">Nenhum risco ficou acima do limiar de ${num(K.regras.limiarDeAcaoObrigatoria)}. O resultado é um plano de monitoramento, não um plano vazio.</div>`}
      ${monitor.length ? `<section class="bloco"><h2>Em monitoramento</h2><p class="pequeno sutil">Abaixo do limiar. Refazer a triagem quando houver ${GATILHOS}.</p>
        <div class="rolagem"><table><tbody>${monitor.map(r => `<tr><td><span class="cod">${r.categoria}</span></td><td>${esc(r.nome)}</td><td class="num">${num(r.escore)}</td><td>${chipFaixa(r)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <div class="rodape-etapa"><button type="button" class="btn" data-ir="${D.acima.length ? "E4" : "E3"}">← Voltar</button>
      <button type="button" class="btn primario" data-acao="concluir">Concluir e ver relatório →</button></div>`;
  }

  /* ============================================================ relatório */
  function telaRelatorio(D) {
    const p = S.perfil, plano = planoEfetivo(D), imed = acoesImediatas(plano);
    const monitor = D.registro.filter(r => !r.acima);
    const total = tempoTotal();
    const removidas = []; plano.forEach(pl => pl.controles.forEach(x => { if (x.removido) removidas.push(x); }));
    const tempoLinhas = ["E1", "E2", "E3", "E4", "E5"].map(e => `<tr><td>${e}</td><td class="num">${fmtTempo(S.metricas.tempoPorEtapa[e] || 0)}</td></tr>`).join("");
    const dataStr = new Date(S.concluidaEm || Date.now()).toLocaleString("pt-BR");
    return `
    <div class="cab-etapa"><span class="rotulo">Relatório da triagem · ${esc(dataStr)}</span><h1>${esc(p.organizacao || "Organização sem nome")}</h1>
      <p class="sutil">${esc(nomeSetor(p.setor))} · ${esc((PORTES.find(x => x[0] === p.porte) || ["", ""])[1])} · ${esc(MODOS.find(m => m[0] === p.modoDeAdocao)[1])}${S.origem === "demo" ? " · caso demonstrativo" : ""}</p></div>
    <div class="bloco nao-imprimir">
      <div class="linha-flex entre"><h2>Exportar</h2><span class="pequeno sutil">Os arquivos são gerados no seu navegador.</span></div>
      <div class="linha-flex">
        <button type="button" class="btn primario" data-acao="pdf">PDF (imprimir)</button>
        <button type="button" class="btn" data-acao="csv">Plano em CSV</button>
        <button type="button" class="btn" data-acao="json">Sessão em JSON</button>
        <button type="button" class="btn" data-acao="copiar-json">Copiar JSON</button>
        <button type="button" class="btn" data-ir="E3">Reavaliar criticidade</button>
      </div>
      <p class="pequeno sutil" id="aviso-export">O JSON permite retomar esta triagem depois e serve como registro para a avaliação da pesquisa.</p>
    </div>
    <div class="kpis" style="margin-top:16px">
      <div class="kpi"><span class="rotulo">Riscos no registro</span><span class="grande">${D.registro.length}</span></div>
      <div class="kpi"><span class="rotulo">Com plano de ação</span><span class="grande">${plano.length}</span></div>
      <div class="kpi"><span class="rotulo">Ações para começar já</span><span class="grande">${imed.length}</span></div>
      <div class="kpi"><span class="rotulo">Tempo de execução</span><span class="grande mono" style="font-size:1.5rem">${fmtTempo(total)}</span></div>
    </div>
    ${imed.length ? `<section class="bloco" style="margin-top:16px"><h2>Para fazer na segunda-feira</h2><p class="pequeno sutil">Ações de esforço baixo e prazo imediato, sem comitê, consultoria ou orçamento.</p>
      <ol class="pilha" style="padding-left:1.2rem;margin:0">${imed.map(x => `<li>${esc(x.c.descricao)} <span class="pequeno sutil">— ${esc(x.executor)} · <span class="cod">${x.c.codigo}</span></span></li>`).join("")}</ol></section>` : ""}
    <section class="bloco"><h2>Contexto e agravantes</h2>
      <p class="pequeno">Agravantes ativos: ${D.mods.length ? D.mods.map(m => `<span class="chip">${esc(modRotulo(m))}</span>`).join(" ") : "nenhum"}</p>
      <p class="pequeno sutil">Ferramentas declaradas: ${p.sistemasDeIA.filter(s => s.nome.trim()).map(s => esc(s.nome) + (s.finalidade ? " (" + esc(s.finalidade) + ")" : "")).join("; ")}.</p>
      <p class="pequeno sutil">Perguntas respondidas: ${D.e2.aplicaveis.length} de ${K.itens.itens.length}. Categorias limpas: ${D.e2.excluidas.join(", ") || "nenhuma"}. Fora do perfil: ${D.e2.foraDoPerfil.join(", ") || "nenhuma"}.</p>
      ${D.registro.some(r => r.I > r.Ideclarado) ? `<p class="pequeno sutil">Impacto elevado ao mínimo definido pelo perfil: ${D.registro.filter(r => r.I > r.Ideclarado).map(r => `${r.categoria} (${r.Ideclarado} → ${r.I}; ${r.pisoRegras.filter(p => p.piso === r.I).map(p => p.codigo).join(", ")})`).join("; ")}.</p>` : ""}
      ${D.registro.some(r => r.frequenciaPelaE2) ? `<p class="pequeno sutil">Frequência definida pela E2: ${D.registro.filter(r => r.frequenciaPelaE2).map(r => `${r.categoria} (${r.frequenciaPelaE2.item})`).join("; ")}.</p>` : ""}</section>
    <section class="bloco"><h2>Registro de riscos priorizado</h2>${D.registro.length ? tabelaRegistro(D, true) : '<p class="sutil">Nenhum risco identificado.</p>'}</section>
    ${plano.map(pl => `<section class="bloco faixa-borda ${pl.risco.faixa}"><div class="linha-flex entre"><h3><span class="cod">${pl.risco.categoria}</span> ${esc(pl.risco.nome)}</h3><span>${chipFaixa(pl.risco)} <span class="chip mono">${num(pl.risco.escore)}</span></span></div>
      <p class="pequeno">Responsável: <b>${esc(respDe(pl.risco.categoria))}</b></p>
      <div class="rolagem"><table><thead><tr><th>#</th><th>Ação</th><th>Esforço</th><th>Prazo</th><th>Executa</th></tr></thead><tbody>
      ${pl.controles.filter(x => !x.removido).map(x => `<tr><td class="num">${x.ordem}</td><td>${esc(x.c.descricao)} <span class="cod">${x.c.codigo}</span></td><td><span class="chip esf-${x.c.esforco}">${ESF[x.c.esforco]}</span></td><td>${HORIZ[x.horizonte]}${x.horizonteAlterado ? " *" : ""}</td><td class="pequeno">${esc(x.executor)}</td></tr>`).join("")}
      </tbody></table></div></section>`).join("")}
    ${removidas.length ? `<section class="bloco"><h2>Ações removidas pelo gestor</h2><ul class="pequeno">${removidas.map(x => `<li><span class="cod">${x.chave.replace("|", " · ")}</span> ${esc(x.c.descricao)} <br><i>Motivo:</i> ${esc(x.justificativa)}</li>`).join("")}</ul></section>` : ""}
    ${monitor.length ? `<section class="bloco"><h2>Monitoramento</h2><p class="pequeno">${monitor.map(r => `<span class="cod">${r.categoria}</span> ${esc(r.nome)} (${num(r.escore)})`).join("<br>")}</p><p class="pequeno sutil">Refazer a triagem quando houver ${GATILHOS}.</p></section>` : ""}
    <section class="bloco"><h2>Métricas de execução</h2><div class="rolagem"><table><thead><tr><th>Etapa</th><th class="num">Tempo</th></tr></thead><tbody>${tempoLinhas}<tr><td><b>Total</b></td><td class="num"><b>${fmtTempo(total)}</b></td></tr></tbody></table></div>
      <p class="pequeno sutil">Decisões registradas na trilha: ${S.metricas.trilhaDeDecisao.length}. Versão do conteúdo: perfil ${esc(S.versaoDoConteudo.perfil || "—")}, taxonomia ${esc(S.versaoDoConteudo.taxonomia)}, itens ${esc(S.versaoDoConteudo.itens)}, controles ${esc(S.versaoDoConteudo.controles)}, regras ${esc(S.versaoDoConteudo.regras)}.</p></section>
    <p class="so-impressao pequeno">Gerado pelo TRIA-PME. * prazo alterado pelo gestor.</p>`;
  }

  /* ============================================================ exportação */
  function sessaoExportavel() {
    const D = derivar(), plano = planoEfetivo(D);
    const tempo = Object.assign({}, S.metricas.tempoPorEtapa);
    if (etapa !== "inicio" && etapa !== "rel") tempo[etapa] = (tempo[etapa] || 0) + (Date.now() - entrouEm);
    return {
      ferramenta: "TRIA-PME", formato: "sessao/2",
      versaoDoConteudo: S.versaoDoConteudo, iniciadaEm: S.iniciadaEm, concluidaEm: S.concluidaEm, origem: S.origem,
      perfil: Object.assign({}, S.perfil, { derivado: D.pm, modificadores: D.mods }),
      respostas: Object.keys(S.respostas).sort().map(k => ({ item: k, valor: S.respostas[k].valor, evidencia: S.respostas[k].evidencia || "" })),
      riscos: D.registro.map(r => ({ categoria: r.categoria, nome: r.nome, impactoDeclarado: r.Ideclarado, pisoDeImpacto: r.piso, regrasDePiso: r.pisoRegras.map(p => p.codigo), impacto: r.I,
        frequencia: r.F, frequenciaPelaE2: r.frequenciaPelaE2 ? r.frequenciaPelaE2.item : null, probabilidade: r.P, fator: r.fator, modificadores: r.modificadores, escore: r.escore, faixa: r.faixa, acimaDoLimiar: r.acima,
        responsavel: r.acima ? { nome: ((S.responsaveis[r.categoria] || {}).nome || "").trim() || null, cargo: ((S.responsaveis[r.categoria] || {}).cargo || "").trim() || null } : null })),
      categoriasExcluidas: D.e2.excluidas, categoriasForaDoPerfil: D.e2.foraDoPerfil,
      intensidadeE2: Object.fromEntries(D.e2.riscos.map(c => [c, N.intensidade(D.e2, c)])),
      plano: plano.map(pl => ({ risco: pl.risco.categoria, controles: pl.controles.map(x => ({ codigo: x.c.codigo, ordem: x.ordem, esforco: x.c.esforco, horizonte: x.horizonte, horizonteOriginal: x.c.horizonte, removido: x.removido, justificativa: x.justificativa || null, executor: x.executor })) })),
      estadoBruto: { avaliacoes: S.avaliacoes, responsaveis: S.responsaveis, ajustes: S.ajustes },
      metricas: { tempoPorEtapaMs: tempo, tempoTotalMs: Object.values(tempo).reduce((a, b) => a + b, 0), trilhaDeDecisao: S.metricas.trilhaDeDecisao },
      integridade: N.invariantes(K).map(i => ({ id: i.id, ok: i.ok }))
    };
  }
  function baixar(nome, conteudo, tipo) {
    try {
      const blob = new Blob([conteudo], { type: tipo });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { avisoExport("O navegador bloqueou o download. Use “Copiar JSON”."); }
  }
  function avisoExport(t) { const el = $("#aviso-export"); if (el) el.textContent = t; }
  function nomeBase() { return "tria-pme_" + (S.perfil.organizacao || "triagem").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) + "_" + new Date().toISOString().slice(0, 10); }
  function csv() {
    const D = derivar(), plano = planoEfetivo(D);
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const linhas = [["risco", "nome_do_risco", "escore", "faixa", "responsavel", "ordem", "controle", "acao", "tipo", "esforco", "prazo", "executa", "situacao", "motivo_remocao"].join(";")];
    plano.forEach(pl => pl.controles.forEach(x => linhas.push([pl.risco.categoria, pl.risco.nome, num(pl.risco.escore), pl.risco.faixaRotulo, respDe(pl.risco.categoria), x.ordem, x.c.codigo, x.c.descricao, x.c.tipo, ESF[x.c.esforco], HORIZ[x.horizonte], x.executor, x.removido ? "removida" : "ativa", x.justificativa].map(q).join(";"))));
    D.registro.filter(r => !r.acima).forEach(r => linhas.push([r.categoria, r.nome, num(r.escore), r.faixaRotulo, "", "", "", "monitoramento", "", "", "", "", "monitorar", ""].map(q).join(";")));
    return "﻿" + linhas.join("\r\n");
  }
  function importar(texto) {
    let obj;
    try { obj = JSON.parse(texto); } catch (e) { mensagem = { texto: "O arquivo não é um JSON válido." }; render(); return; }
    if (obj.ferramenta !== "TRIA-PME" || !obj.perfil || !obj.estadoBruto) { mensagem = { texto: "Este arquivo não foi exportado pelo TRIA-PME." }; render(); return; }
    S = sessaoVazia();
    const pf = Object.assign({}, obj.perfil); delete pf.derivado; delete pf.modificadores;
    S.perfil = Object.assign(S.perfil, pf);
    S.respostas = {}; (obj.respostas || []).forEach(r => S.respostas[r.item] = { valor: r.valor, evidencia: r.evidencia || "" });
    S.avaliacoes = obj.estadoBruto.avaliacoes || {}; S.responsaveis = obj.estadoBruto.responsaveis || {};
    S.ajustes = obj.estadoBruto.ajustes || { removidos: {}, horizontes: {} };
    const convertida = converterSessaoV1(obj);
    S.iniciadaEm = obj.iniciadaEm || S.iniciadaEm; S.concluidaEm = obj.concluidaEm || null; S.origem = obj.origem || "importada";
    S.metricas = { tempoPorEtapa: (obj.metricas && obj.metricas.tempoPorEtapaMs) || {}, trilhaDeDecisao: (obj.metricas && obj.metricas.trilhaDeDecisao) || [] };
    const vAtual = JSON.stringify(versoes()), vArq = JSON.stringify(obj.versaoDoConteudo || {});
    trilha("sessão retomada de arquivo", (vAtual === vArq ? "" : "versão de conteúdo diferente: " + vArq) + (convertida ? " · convertida do formato sessao/1" : ""));
    mensagem = vAtual === vArq ? { tipo: "ok", texto: "Triagem retomada do arquivo." } : { texto: "Triagem retomada, mas ela foi feita com outra versão do conteúdo" + (convertida ? " (frequências de 1 a 5 convertidas: 1–2 → nunca aconteceu; 3–5 → já aconteceu; responsáveis convertidos de papel para nome e cargo)" : "") + ". Confira as respostas antes de comparar resultados." };
    etapa = "inicio"; irPara(S.concluidaEm && liberada("rel") ? "rel" : primeiraPendente());
  }
  /* Sessões exportadas pela versão 0.1.0 (PBL6/PBL7): escala de frequência de 5 níveis e responsável como papel. */
  function converterSessaoV1(obj) {
    let mudou = false;
    Object.keys(S.avaliacoes).forEach(c => {
      const a = S.avaliacoes[c];
      if (a && a.P !== undefined && a.F === undefined) { S.avaliacoes[c] = { I: a.I, F: a.P >= 3 ? "jaAconteceu" : "nunca", Pv1: a.P }; mudou = true; }
    });
    Object.keys(S.responsaveis).forEach(c => {
      const r = S.responsaveis[c];
      if (typeof r === "string") { const pp = PAPEIS.find(x => x[0] === r); S.responsaveis[c] = { nome: (S.perfil.pessoas[r] || "").trim(), cargo: pp ? pp[1].replace(/ \(.*\)$/, "") : r }; mudou = true; }
    });
    return mudou;
  }
  function primeiraPendente() {
    const D = derivar();
    if (pendenciasE1().length) return "E1";
    if (D.e2.pendentes.length) return "E2";
    if (D.naoAvaliados.length) return "E3";
    if (D.acima.some(r => !responsavelValido(r.categoria))) return "E4";
    return "E5";
  }

  /* ============================================================ eventos */
  document.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.ir) { irPara(b.dataset.ir); return; }
    if (b.dataset.bool) { S.perfil[b.dataset.bool] = b.dataset.v === "true"; salvarLocal(); render(); return; }
    if (b.dataset.resp) {
      const cod = b.dataset.resp, ant = S.respostas[cod] || {};
      S.respostas[cod] = { valor: b.dataset.v, evidencia: ant.evidencia || "" };
      if (ant.valor && ant.valor !== b.dataset.v) trilha("resposta alterada", cod + ": " + ant.valor + " → " + b.dataset.v);
      salvarLocal(); render(); return;
    }
    if (b.dataset.grupo !== undefined) { grupoAtual = +b.dataset.grupo; render(); window.scrollTo(0, 0); return; }
    const a = b.dataset.acao;
    if (!a) return;
    if (a === "nova") { S = sessaoVazia(); trilha("triagem iniciada"); etapa = "inicio"; irPara("E1"); }
    else if (a === "demo") {
      S = sessaoVazia(); S.origem = "demo";
      S.perfil = Object.assign(S.perfil, JSON.parse(JSON.stringify(CASO.perfil)));
      Object.keys(CASO.respostas).forEach(k => S.respostas[k] = { valor: CASO.respostas[k], evidencia: "" });
      S.avaliacoes = JSON.parse(JSON.stringify(CASO.avaliacoes));
      S.responsaveis = JSON.parse(JSON.stringify(CASO.responsaveis));
      trilha("caso demonstrativo carregado", CASO.arquivo + " v" + CASO.versao);
      mensagem = { tipo: "info", texto: "Caso demonstrativo carregado: clínica odontológica fictícia com 22 funcionários. Todas as etapas já estão preenchidas; avance com “Continuar” para percorrer o método." };
      etapa = "inicio"; grupoAtual = 0; irPara("E1");
    }
    else if (a === "retomar-local") { const s = lerLocal(); if (s) { S = s.S; persistir = true; $("#persistir").checked = true; etapa = "inicio"; irPara(s.etapa || "E1"); } }
    else if (a === "apagar-local") { apagarLocal(); render(); }
    else if (a === "avancar") {
      const alvo = b.dataset.alvo;
      if (etapa === "E1") { const D0 = derivar(); trilha("contexto concluído", "modificadores: " + (D0.mods.join(", ") || "nenhum") + " · fora do perfil: " + (D0.e2.foraDoPerfil.join(", ") || "nenhuma")); }
      if (etapa === "E3") trilha("priorização concluída", derivar().registro.map(r => r.categoria + "=" + num(r.escore)).join(" "));
      irPara(alvo);
    }
    else if (a === "add-sistema") { S.perfil.sistemasDeIA.push({ nome: "", finalidade: "", fornecedor: "", sancionado: "" }); render(); }
    else if (a === "rm-sistema") { S.perfil.sistemasDeIA.splice(+b.dataset.i, 1); render(); }
    else if (a === "resumo-e2") { verResumoE2 = true; trilha("identificação concluída", derivar().e2.riscos.join(", ")); render(); window.scrollTo(0, 0); }
    else if (a === "voltar-perguntas") { verResumoE2 = false; render(); }
    else if (a === "registro-e3") { verRegistroE3 = true; trilha("registro de riscos exibido", derivar().registro.map(r => r.categoria + "=" + num(r.escore)).join(" ")); render(); window.scrollTo(0, 0); }
    else if (a === "voltar-avaliacoes") { verRegistroE3 = false; render(); }
    else if (a === "remover") { removendo = b.dataset.ch; render(); const t = document.getElementById("just-" + removendo); if (t) t.focus(); }
    else if (a === "cancelar-remocao") { removendo = null; render(); }
    else if (a === "confirmar-remocao") {
      const t = document.getElementById("just-" + b.dataset.ch), motivo = t ? t.value.trim() : "";
      if (motivo.length < 5) { t.placeholder = "Escreva o motivo para poder remover (mínimo de 5 caracteres)."; t.focus(); return; }
      S.ajustes.removidos[b.dataset.ch] = motivo; trilha("ação removida", b.dataset.ch + " — " + motivo); removendo = null; salvarLocal(); render();
    }
    else if (a === "restaurar") { delete S.ajustes.removidos[b.dataset.ch]; trilha("ação restaurada", b.dataset.ch); salvarLocal(); render(); }
    else if (a === "concluir") { S.concluidaEm = new Date().toISOString(); trilha("plano concluído"); irPara("rel"); }
    else if (a === "pdf") { trilha("exportado", "PDF"); window.print(); }
    else if (a === "csv") { trilha("exportado", "CSV"); baixar(nomeBase() + "_plano.csv", csv(), "text/csv;charset=utf-8"); }
    else if (a === "json") { trilha("exportado", "JSON"); baixar(nomeBase() + ".json", JSON.stringify(sessaoExportavel(), null, 2), "application/json"); }
    else if (a === "copiar-json") {
      const txt = JSON.stringify(sessaoExportavel(), null, 2);
      const ok = () => avisoExport("JSON copiado para a área de transferência.");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => avisoExport("Não foi possível copiar automaticamente."));
    }
  });

  document.addEventListener("change", ev => {
    const t = ev.target;
    if (t.id === "persistir") {
      persistir = t.checked;
      if (persistir) salvarLocal(); else apagarLocal();
      return;
    }
    if (t.id === "arquivo-importar" && t.files && t.files[0]) {
      const fr = new FileReader(); fr.onload = () => importar(String(fr.result)); fr.readAsText(t.files[0], "utf-8"); return;
    }
    if (!S) return;
    if (t.dataset.campo) { S.perfil[t.dataset.campo] = t.value; salvarLocal(); if (t.tagName === "SELECT") render(); return; }
    if (t.dataset.dado) {
      const d = t.dataset.dado; let lista = S.perfil.naturezaDosDados.filter(x => x !== d);
      if (t.checked) { lista = d === "nenhum" ? ["nenhum"] : lista.filter(x => x !== "nenhum").concat(d); }
      S.perfil.naturezaDosDados = lista; salvarLocal(); render(); return;
    }
    if (t.dataset.modo) { S.perfil.modoDeAdocao = t.dataset.modo; salvarLocal(); render(); return; }
    if (t.dataset.sis !== undefined && t.tagName === "SELECT") { S.perfil.sistemasDeIA[+t.dataset.sis][t.dataset.k] = t.value; salvarLocal(); return; }
    if (t.dataset.aval) {
      const c = t.dataset.aval, v = t.dataset.tipo === "I" ? +t.value : t.value;
      const ant = (S.avaliacoes[c] || {})[t.dataset.tipo];
      S.avaliacoes[c] = Object.assign({}, S.avaliacoes[c], { [t.dataset.tipo]: v });
      if (ant !== undefined && ant !== v && S.metricas.trilhaDeDecisao.some(x => x.evento === "registro de riscos exibido"))
        trilha("avaliação alterada depois de ver o registro", c + " " + t.dataset.tipo + ": " + ant + " → " + v);
      salvarLocal(); const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
    if (t.dataset.respCat) { definirResponsavel(t, true); return; }
    if (t.dataset.horiz) {
      const ch = t.dataset.horiz, orig = IDX.ctrls[ch.split("|")[1]].horizonte;
      if (t.value === orig) delete S.ajustes.horizontes[ch]; else S.ajustes.horizontes[ch] = t.value;
      trilha("prazo alterado", ch + ": " + orig + " → " + t.value); salvarLocal(); const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
  });

  document.addEventListener("input", ev => {
    const t = ev.target; if (!S) return;
    if (t.dataset.campo && t.tagName === "INPUT") { S.perfil[t.dataset.campo] = t.value; salvarLocal(); return; }
    if (t.dataset.pessoa) { S.perfil.pessoas[t.dataset.pessoa] = t.value; salvarLocal(); atualizarRodapeE1(); return; }
    if (t.dataset.sis !== undefined && t.tagName === "INPUT") { S.perfil.sistemasDeIA[+t.dataset.sis][t.dataset.k] = t.value; salvarLocal(); atualizarRodapeE1(); return; }
    if (t.dataset.respCat) { definirResponsavel(t, false); return; }
    if (t.dataset.ev) { const r = S.respostas[t.dataset.ev] || { valor: undefined }; r.evidencia = t.value; if (r.valor) S.respostas[t.dataset.ev] = r; salvarLocal(); return; }
  });
  function atualizarRodapeE1() {
    if (etapa !== "E1") return;
    const pend = pendenciasE1(), rod = $(".rodape-etapa");
    if (!rod) return;
    const bt = rod.querySelector('[data-acao="avancar"]'), bl = rod.querySelector(".bloqueio");
    bt.disabled = !!pend.length;
    if (bl) bl.textContent = pend.length ? "Falta: " + pend.join(", ") + "." : "";
    else if (pend.length) { const s = document.createElement("span"); s.className = "bloqueio"; s.textContent = "Falta: " + pend.join(", ") + "."; bt.before(s); }
    const D = derivar();
    $("#trilho").querySelectorAll("button").forEach(btn => { const id = btn.dataset.ir; btn.disabled = !(id === "inicio" || liberada(id, D)); });
  }

  /* ============================================================ carga do conteúdo (DA1) */
  async function carregar() {
    const arquivos = { perfil: "perfil.json", taxonomia: "taxonomia.json", itens: "itens.json", controles: "controles.json", regras: "regras.json", caso: "caso_demonstrativo.json" };
    const out = {};
    try {
      for (const k of Object.keys(arquivos)) {
        const r = await fetch("conteudo/" + arquivos[k], { cache: "no-cache" });
        if (!r.ok) throw new Error(arquivos[k]);
        out[k] = await r.json();
      }
    } catch (e) {
      // aberto direto do disco (file://): usa o pacote gerado a partir dos mesmos JSON
      if (!window.TRIA_CONTEUDO) throw e;
      Object.assign(out, window.TRIA_CONTEUDO);
    }
    CASO = out.caso; delete out.caso;
    K = out; IDX = N.indices(K);
    const P = K.perfil.campos;
    SETORES = P.setor.opcoes; PORTES = P.porte.opcoes; DADOS = P.naturezaDosDados.opcoes; MODOS = P.modoDeAdocao.opcoes;
    PAPEIS = K.perfil.papeis.map(x => [x[0], x[1]]); PAPEL_CURTO = {}; K.perfil.papeis.forEach(x => PAPEL_CURTO[x[0]] = x[2]);
    ALCANCE = K.perfil.perguntasDeAlcance;
  }

  carregar().then(() => {
    const salvo = lerLocal();
    if (salvo) { persistir = true; $("#persistir").checked = true; }
    render();
  }).catch(err => {
    $("#conteudo").innerHTML = `<div class="aviso">Não foi possível carregar a base de conhecimento (${esc(err.message)}). Verifique se a pasta “conteudo” está ao lado do index.html.</div>`;
  });
})();

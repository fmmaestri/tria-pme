/* TRIA-PME 0.2.0 (PBL8) — testes do núcleo. Uso: node testes/teste_nucleo.js
 * T1  invariantes do conteúdo (INV1–INV11)
 * T2  a derivação do perfil lida de perfil.json reproduz a regra que estava em app.js na versão 0.1.0
 * T3  frequência preenchida pela E2
 * T4  piso de impacto
 * T5  limite de uma resposta isolada na E3
 * T6  regressão: caso demonstrativo de ponta a ponta
 * T7  lacunas da taxonomia (subdomínios 1.2 e 4.3) */
const fs = require("fs"), path = require("path"), assert = require("assert");
const N = require("../js/nucleo.js");
const dir = path.join(__dirname, "..", "conteudo");
const ler = f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const K = { perfil: ler("perfil.json"), taxonomia: ler("taxonomia.json"), itens: ler("itens.json"), controles: ler("controles.json"), regras: ler("regras.json") };
const caso = ler("caso_demonstrativo.json");
let n = 0;
function t(nome, fn) { fn(); n++; console.log("[OK ] " + nome); }

/* ---------------------------------------------------------------- T1 */
const inv = N.invariantes(K);
inv.forEach(i => console.log((i.ok ? "      " : "FALHA ") + i.id + " " + i.nome + " — " + i.detalhe));
t("T1 invariantes do conteúdo: " + inv.length + "/" + inv.length, () => assert(inv.every(i => i.ok)));

/* ---------------------------------------------------------------- T2 */
/* regra da versão 0.1.0, copiada de app.js (perfilMotor) para servir de referência */
function perfilV1(p) {
  return { porte: p.porte, setor: p.setor, naturezaDosDados: p.naturezaDosDados.filter(d => d !== "nenhum"), modoDeAdocao: p.modoDeAdocao,
    criticidadeDaDecisao: p.decideSobrePessoas ? ["afetaPessoas"] : (p.exposicaoAExterno ? ["apoiaConteudoExterno"] : ["usoInterno"]),
    exposicaoAExterno: p.exposicaoAExterno === true, publicaConteudo: p.publicaConteudo === true, processaConteudoExterno: p.processaConteudoExterno === true };
}
t("T2 perfil.json reproduz a derivação antiga nas 16 combinações das perguntas de alcance × 3 formas de uso × 3 conjuntos de dados", () => {
  let casos = 0;
  for (let m = 0; m < 16; m++) for (const modo of ["SaaS", "API", "ModeloProprio"]) for (const dados of [["nenhum"], ["pessoaisComuns"], ["pessoaisComuns", "saude"]]) {
    const e1 = { porte: "10-49", setor: "comercio", naturezaDosDados: dados, modoDeAdocao: modo,
      decideSobrePessoas: !!(m & 1), exposicaoAExterno: !!(m & 2), publicaConteudo: !!(m & 4), processaConteudoExterno: !!(m & 8) };
    assert.deepStrictEqual(N.derivarPerfil(K, e1), perfilV1(e1)); casos++;
  }
  assert.strictEqual(casos, 144);
});

/* ---------------------------------------------------------------- T3 */
const pS3 = N.derivarPerfil(K, { porte: "10-49", setor: "comercio", naturezaDosDados: ["pessoaisComuns"], modoDeAdocao: "API",
  decideSobrePessoas: true, exposicaoAExterno: true, publicaConteudo: true, processaConteudoExterno: true });
t("T3 frequência pela E2: 'sim' → já aconteceu; 'não sei' → não sei; 'não' → nada; I-20 não preenche C09", () => {
  const f = N.frequenciaPelaE2(K, pS3, { "I-08": "sim", "I-03": "naoSei", "I-06": "nao", "I-19": "sim", "I-20": "sim" });
  assert.deepStrictEqual(Object.keys(f).sort(), ["C01", "C03", "C08"]);
  assert.strictEqual(f.C03.codigo, "jaAconteceu"); assert.strictEqual(f.C01.codigo, "naoSei"); assert.strictEqual(f.C08.codigo, "jaAconteceu");
  /* a frequência da E2 prevalece sobre a declarada na E3 (caso do piloto do PBL7: E2 'sim' e E3 'nunca') */
  const reg = N.priorizar(K, ["C03"], { C03: { I: 5, F: "nunca" } }, [], pS3, { "I-08": "sim" });
  assert.strictEqual(reg[0].F, "jaAconteceu"); assert.strictEqual(reg[0].escore, 20); assert(reg[0].acima);
});

/* ---------------------------------------------------------------- T4 */
t("T4 piso de impacto: valores, regra mais alta prevalece, impacto declarado maior é respeitado", () => {
  const pClin = N.derivarPerfil(K, caso.perfil), mClin = N.modificadoresAtivos(K, pClin);
  assert.strictEqual(N.pisoDeImpacto(K, "C01", pClin, mClin, {}).valor, 4);          /* PI-01 (4) > PI-03 (3) > PI-04 (3) */
  assert.deepStrictEqual(N.pisoDeImpacto(K, "C01", pClin, mClin, {}).regras.map(r => r.codigo), ["PI-01", "PI-03", "PI-04"]);
  assert.strictEqual(N.pisoDeImpacto(K, "C07", pClin, mClin, {}).valor, 1);          /* sem regra para C07 */
  const mS3 = N.modificadoresAtivos(K, pS3);
  assert.strictEqual(N.pisoDeImpacto(K, "C04", pS3, mS3, {}).valor, 3);             /* PI-02 */
  assert.strictEqual(N.pisoDeImpacto(K, "C01", pS3, mS3, {}).valor, 3);             /* PI-04 */
  assert.strictEqual(N.pisoDeImpacto(K, "C03", pS3, [], { "I-08": "sim" }).valor, 3); /* PI-05 */
  assert.strictEqual(N.pisoDeImpacto(K, "C03", pS3, [], { "I-08": "nao" }).valor, 1);
  const r1 = N.pontuar(K, "C01", 2, "nunca", mClin, 4), r2 = N.pontuar(K, "C01", 5, "nunca", mClin, 4);
  assert.strictEqual(r1.I, 4); assert.strictEqual(r1.Ideclarado, 2); assert.strictEqual(r2.I, 5);
});

/* ---------------------------------------------------------------- T5 */
t("T5 resposta isolada: com piso 4 e evento já ocorrido, impacto declarado 1 não tira o risco do plano", () => {
  const pClin = N.derivarPerfil(K, caso.perfil), mClin = N.modificadoresAtivos(K, pClin);
  ["C01", "C02", "C09", "C10"].forEach(c => {
    const r = N.priorizar(K, [c], { [c]: { I: 1, F: "jaAconteceu" } }, mClin, pClin, {})[0];
    assert(r.acima, c + " deveria seguir para o plano (escore " + r.escore + ")");
  });
  /* e o escore máximo sem piso e com frequência "nunca" continua abaixo do limiar quando I = 1 */
  assert(N.pontuar(K, "C07", 1, "jaAconteceu", ["m_dados_sensiveis", "m_decisao_sobre_pessoas", "m_setor_regulado"], 1).escore < 14);
});

/* ---------------------------------------------------------------- T6 */
const pm = N.derivarPerfil(K, caso.perfil);
const mods = N.modificadoresAtivos(K, pm);
const e2 = N.identificar(K, pm, caso.respostas);
const reg = N.priorizar(K, e2.riscos, caso.avaliacoes, mods, pm, caso.respostas);
const plano = N.derivarPlano(K, reg, pm);
t("T6 regressão do caso demonstrativo (clínica odontológica)", () => {
  assert.deepStrictEqual(mods.sort(), ["m_dados_sensiveis", "m_setor_regulado"]);
  assert.strictEqual(e2.aplicaveis.length, 24);
  assert.deepStrictEqual(e2.riscos, ["C01", "C02", "C03", "C05", "C06", "C07", "C09", "C10", "C11", "C12"]);
  assert.deepStrictEqual(e2.excluidas, ["C08"]);
  assert.deepStrictEqual(e2.foraDoPerfil, ["C04"]);
  assert.deepStrictEqual(reg.map(r => [r.categoria, r.escore, r.faixaRotulo]), [
    ["C01", 30, "Crítico"], ["C10", 24, "Crítico"], ["C02", 20.8, "Alto"], ["C09", 20.8, "Alto"], ["C06", 14.4, "Alto"],
    ["C07", 12, "Moderado"], ["C05", 9.6, "Moderado"], ["C03", 8, "Moderado"], ["C12", 8, "Moderado"], ["C11", 6, "Baixo"]]);
  /* mesmo conjunto de riscos com plano que na versão 0.1.0 (C01, C10, C09, C06, C02) */
  assert.deepStrictEqual(reg.filter(r => r.acima).map(r => r.categoria).sort(), ["C01", "C02", "C06", "C09", "C10"]);
  assert.deepStrictEqual(reg.filter(r => r.I > r.Ideclarado).map(r => r.categoria).sort(), ["C02", "C10"]);
  assert.deepStrictEqual(reg.filter(r => r.frequenciaPelaE2).map(r => r.categoria).sort(), ["C01", "C02"]);
  assert.deepStrictEqual(plano.C01, ["CT-01", "CT-02", "CT-03", "CT-18"]);
});

/* ---------------------------------------------------------------- T7 */
t("T7 subdomínios 1.2 e 4.3 cobertos, com pergunta e ≥ 2 controles aplicáveis no perfil em que aparecem", () => {
  const i29 = K.itens.itens.find(i => i.codigo === "I-29"), i30 = K.itens.itens.find(i => i.codigo === "I-30");
  assert.strictEqual(i29.categoria, "C03"); assert.strictEqual(i30.categoria, "C11");
  assert.deepStrictEqual(i30.condicaoDeAplicabilidade, {});                         /* fraude com IA vale para qualquer empresa */
  assert(N.derivarControles(K, "C11", pm).length >= 2);                             /* clínica sem chatbot: CT-30 e CT-31 */
  assert.deepStrictEqual(N.derivarControles(K, "C11", pm).map(c => c.codigo), ["CT-30", "CT-31"]);
  assert(N.derivarControles(K, "C03", pS3).some(c => c.codigo === "CT-29"));
});

console.log("\nCaso demonstrativo — registro de riscos (v0.2.0):");
reg.forEach(r => console.log("  " + r.categoria, "I declarado", r.Ideclarado, "→ efetivo", r.I, "| F", r.F + (r.frequenciaPelaE2 ? " (E2 " + r.frequenciaPelaE2.item + ")" : ""), "| fator", r.fator.toFixed(2), "| escore", r.escore.toFixed(2), r.faixaRotulo, r.acima ? "→ PLANO" : ""));
console.log("Controles distintos no plano:", new Set(Object.values(plano).flat()).size);
console.log("\n" + n + " grupos de teste aprovados.");

/* TRIA-PME 0.2.0 (PBL8) — teste de ponta a ponta da interface, num navegador real (Playwright + Chromium).
 * Uso: node testes/teste_interface.js [pasta-de-capturas] [sessao-v1.json]
 * Abre o index.html direto do disco (file://), como o usuário faria, e confere as melhorias da versão 0.2.0.
 * Requer: npm i playwright (ou Playwright já instalado). */
const path = require("path"), fs = require("fs"), assert = require("assert");
const { chromium } = require("playwright");
const RAIZ = path.join(__dirname, "..");
const CAPT = process.argv[2] || path.join(RAIZ, "testes", "capturas");
const SESSAO_V1 = process.argv[3] || null;
fs.mkdirSync(CAPT, { recursive: true });
let n = 0;
const ok = nome => { n++; console.log("[OK ] " + nome); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = []; page.on("pageerror", e => erros.push(e.message));
  await page.goto("file://" + path.join(RAIZ, "index.html"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-acao="demo"]');
  const cap = async (nome, sel) => { await page.addStyleTag({ content: ".topo{position:static!important}" }); const el = sel ? page.locator(sel).first() : page; await el.screenshot({ path: path.join(CAPT, nome + ".png"), ...(sel ? {} : { fullPage: false }) }); };

  /* 1. Início: invariantes */
  const inv = await page.$$eval("details.bloco tr", trs => trs.map(t => t.textContent));
  assert.strictEqual(inv.length, 11); assert(inv.every(t => t.startsWith("OK")));
  ok("U1 tela inicial carrega o conteúdo 0.2.0 e mostra 11/11 invariantes OK");

  /* 2. Caso demonstrativo: E1 com o quadro do perfil */
  await page.click('[data-acao="demo"]');
  await page.waitForSelector("#quadro-perfil");
  const quadro = await page.textContent("#quadro-perfil");
  assert(/C04/.test(quadro) && /porque a IA não ajuda a decidir sobre pessoas/.test(quadro), quadro);
  assert(/Trata dado pessoal sensível/.test(quadro));
  await cap("01_E1_quadro_do_perfil", "#quadro-perfil");
  ok("U2 E1 mostra o que o perfil ativou e por que C04 ficou fora da triagem");

  /* 3. A pergunta reescrita da E1 */
  const perg = await page.textContent(".pergunta-sn:nth-of-type(2)");
  assert(/candidatos a emprego, funcionários, clientes ou pacientes/.test(perg));
  ok("U3 pergunta sobre decisão que afeta pessoas usa a nova redação (lida de perfil.json)");

  /* 4. E3 sem escore, com frequência travada pela E2 e piso de impacto */
  await page.click('#trilho [data-ir="E3"]');
  await page.waitForSelector("#risco-C01");
  const textoE3 = await page.textContent("#conteudo");
  assert(!/escore\s*\d/i.test(textoE3) && !/segue para o plano|fica em monitoramento/.test(textoE3));
  assert.strictEqual(await page.locator("#risco-C01 .chip.sev-critico, #risco-C01 .chip.sev-alto").count(), 0);
  ok("U4 E3 não mostra escore, faixa nem destino enquanto o respondente avalia");
  assert(await page.isDisabled('input[name="F-C01"][value="nunca"]'));
  assert(/Já respondido na E2 \(I-03/.test(await page.textContent("#risco-C01")));
  ok("U5 frequência de C01 vem da E2 (I-03) e não pode ser contrariada na E3");
  for (const v of [1, 2, 3]) assert(await page.isDisabled(`input[name="I-C02"][value="${v}"]`));
  assert(!(await page.isDisabled('input[name="I-C02"][value="4"]')));
  assert(/Impacto mínimo 4/.test(await page.textContent("#risco-C02")));
  await cap("02_E3_piso_e_frequencia_pela_E2", "#risco-C02");
  ok("U6 piso de impacto de C02 (dados de saúde) bloqueia as opções 1 a 3");
  assert(/O evento:/.test(await page.textContent("#risco-C07")));
  ok("U7 a pergunta de frequência descreve o evento de cada categoria");

  /* 5. Registro de riscos só depois */
  await page.click('[data-acao="registro-e3"]');
  await page.waitForSelector("table");
  const linhas = await page.$$eval("#conteudo tbody tr", trs => trs.map(t => t.textContent.replace(/\s+/g, " ").trim()));
  assert.strictEqual(linhas.length, 10);
  assert(/C01.*30,00.*Crítico/.test(linhas[0]) && /C10.*4p.*24,00.*Crítico/.test(linhas[1]), linhas.slice(0, 2).join(" | "));
  await cap("03_E3_registro_de_riscos", "#conteudo .bloco");
  ok("U8 registro de riscos aparece só ao final da E3, com marca do piso (p) e da E2 (e)");

  /* 6. E4 com nome e cargo livres */
  await page.click('[data-acao="avancar"]');
  await page.waitForSelector("#respn-C01");
  assert.strictEqual(await page.inputValue("#respn-C01"), "Dra. Helena Duarte");
  await page.fill("#respc-C09", "");
  assert(await page.isDisabled('[data-acao="avancar"]'));
  await page.fill("#respn-C09", "Marcelo Reis"); await page.fill("#respc-C09", "TI (terceirizado)");
  assert(!(await page.isDisabled('[data-acao="avancar"]')));
  await cap("04_E4_responsaveis_nome_e_cargo", "#conteudo .bloco");
  ok("U9 E4 exige nome e cargo livres; avançar fica bloqueado enquanto falta um campo");

  /* 7. E5 e relatório; exportação JSON */
  await page.click('[data-acao="avancar"]');
  await page.waitForSelector('[data-acao="concluir"]');
  const e5 = await page.textContent("#conteudo");
  assert(/Responsável: Dra\. Helena Duarte \(Sócia-diretora\)/.test(e5));
  await page.click('[data-acao="concluir"]');
  await page.waitForSelector('[data-acao="json"]');
  const rel = await page.textContent("#conteudo");
  assert(/Impacto elevado ao mínimo definido pelo perfil:/.test(rel) && /C02 \(3 → 4; PI-01\)/.test(rel) && /C10 \(3 → 4; PI-01\)/.test(rel));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-acao="json"]')]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  assert.strictEqual(exp.formato, "sessao/2");
  const c10 = exp.riscos.find(r => r.categoria === "C10");
  assert.deepStrictEqual([c10.impactoDeclarado, c10.impacto, c10.regrasDePiso.includes("PI-01"), c10.frequencia], [3, 4, true, "jaAconteceu"]);
  assert.deepStrictEqual(exp.riscos.find(r => r.categoria === "C01").responsavel, { nome: "Dra. Helena Duarte", cargo: "Sócia-diretora" });
  assert.strictEqual(exp.versaoDoConteudo.perfil, "0.2.0");
  await cap("05_relatorio", ".kpis");
  ok("U10 relatório e JSON exportado registram piso, frequência da E2, responsável com cargo e versão 0.2.0");

  /* 8. Nova triagem: o erro do piloto fica visível na E1 */
  await page.click('[data-ir="inicio"]'); await page.click('[data-acao="nova"]');
  await page.waitForSelector("#f-porte");
  await page.selectOption("#f-porte", "10-49"); await page.selectOption("#f-setor", "comercio");
  await page.check("#d-pessoaisComuns"); await page.check("#m-API");
  for (const [campo, v] of [["exposicaoAExterno", "true"], ["decideSobrePessoas", "false"], ["publicaConteudo", "true"], ["processaConteudoExterno", "true"]])
    await page.click(`[data-bool="${campo}"][data-v="${v}"]`);
  let q = await page.textContent("#quadro-perfil");
  assert(/C04 Discriminação em decisão sobre pessoas — porque a IA não ajuda a decidir sobre pessoas/.test(q));
  await page.click('[data-bool="decideSobrePessoas"][data-v="true"]');
  q = await page.textContent("#quadro-perfil");
  assert(/Todos os 12 temas de risco entram na triagem/.test(q) && /A IA apoia decisão que afeta pessoas/.test(q));
  await cap("06_E1_quadro_apos_correcao", "#quadro-perfil");
  ok("U11 nova triagem (perfil da Loja Aurora): responder 'não' deixa C04 fora com o motivo; corrigir para 'sim' traz C04 e o agravante de volta");
  await page.fill("#s-nome-0", "Chatbot de atendimento");
  assert(!(await page.isDisabled('.rodape-etapa [data-acao="avancar"]')));
  ok("U12 E1 pode ser concluída sem cadastrar pessoas (passaram a ser opcionais)");

  /* 9. Retomar sessão exportada pela versão 0.1.0 (piloto do PBL7) */
  if (SESSAO_V1) {
    await page.click('[data-ir="inicio"]');
    await page.setInputFiles("#arquivo-importar", SESSAO_V1);
    await page.waitForSelector("#conteudo .aviso");
    const av = await page.textContent("#conteudo .aviso");
    assert(/convertidas/.test(av), av);
    /* a sessão antiga não tem as perguntas novas: a ferramenta leva o usuário a respondê-las na E2 */
    assert(/Identificação de riscos/.test(await page.textContent("#conteudo h1")));
    assert(await page.locator('[data-resp="I-30"]').count() + await page.locator('[data-grupo]').count() > 0);
    ok("U13 sessão do piloto do PBL7 (formato sessao/1) é aberta e convertida para a nova escala");
  }

  assert.deepStrictEqual(erros, []);
  ok("U14 nenhum erro de JavaScript durante o percurso");
  await browser.close();
  console.log("\n" + n + " verificações de interface aprovadas. Capturas em " + CAPT);
})().catch(e => { console.error("FALHA:", e.message); process.exit(1); });

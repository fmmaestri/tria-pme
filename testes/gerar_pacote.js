/* Gera conteudo/conteudo.js a partir dos JSON da base de conhecimento.
 * O pacote só é usado quando a aplicação é aberta direto do disco (file://),
 * onde o navegador bloqueia a leitura dos JSON. A fonte de verdade continua sendo os JSON.
 * Uso: node testes/gerar_pacote.js */
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "conteudo");
const mapa = { perfil: "perfil.json", taxonomia: "taxonomia.json", itens: "itens.json", controles: "controles.json", regras: "regras.json", caso: "caso_demonstrativo.json" };
const pacote = {};
for (const k in mapa) pacote[k] = JSON.parse(fs.readFileSync(path.join(dir, mapa[k]), "utf8"));
fs.writeFileSync(path.join(dir, "conteudo.js"),
  "/* GERADO por testes/gerar_pacote.js a partir dos arquivos JSON desta pasta. Não editar à mão. */\n" +
  "window.TRIA_CONTEUDO = " + JSON.stringify(pacote) + ";\n");
console.log("conteudo.js gerado.");

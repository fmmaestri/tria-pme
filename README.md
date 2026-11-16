# TRIA-PME — instanciação web (versão 0.2.0, PBL8)

Aplicação estática, 100% no navegador, que executa o método TRIA-PME (E1 → E5) sobre os arquivos de conhecimento em `conteudo/`.

## Abrir
- **Local:** dê dois cliques em `index.html` (funciona sem servidor, usando `conteudo/conteudo.js`).
- **Link público (GitHub Pages):** suba esta pasta para um repositório, depois *Settings → Pages → Deploy from branch → main / (root)*. O link fica `https://<usuario>.github.io/<repositorio>/`.

## Estrutura
| Caminho | Papel |
|---|---|
| `conteudo/perfil.json` | **Novo no PBL8.** Perguntas da E1 e regras que traduzem as respostas no perfil (antes estavam em `app.js`). |
| `conteudo/taxonomia.json` · `itens.json` · `controles.json` · `regras.json` | Taxonomia (12 categorias), 30 perguntas, 31 controles, regras de cálculo (escala de frequência, pisos de impacto, frequência pela E2, faixas). |
| `conteudo/caso_demonstrativo.json` | Clínica odontológica fictícia, convertida para a versão 0.2.0. |
| `conteudo/conteudo.js` | Pacote gerado a partir dos JSON, usado só quando aberto via `file://`. Regerar com `node testes/gerar_pacote.js` após editar um JSON. |
| `js/nucleo.js` | Motores do método como funções puras (DA3). |
| `js/app.js` | Interface: assistente por etapas, registro, editor do plano, exportador, métricas. |
| `testes/teste_nucleo.js` | `node testes/teste_nucleo.js` — 7 grupos de testes do núcleo (invariantes, perfil, piso, frequência pela E2, regressão do caso demonstrativo). |
| `testes/teste_interface.js` | `node testes/teste_interface.js [pasta-capturas] [sessao-antiga.json]` — percurso completo num navegador real (requer Playwright). |

## O que mudou da 0.1.0 para a 0.2.0
1. Piso de impacto definido pelo perfil e pela E2 (`regras.pisosDeImpacto`).
2. Frequência com três opções: nunca aconteceu / já aconteceu / não sei (não sei conta como já aconteceu).
3. Frequência preenchida pela E2 quando uma pergunta já relata o evento (I-03, I-06, I-08, I-19).
4. Escore e destino ocultos durante a E3; o registro só aparece no fim.
5. E4 com nome e cargo livres; pessoas da E1 passam a ser opcionais.
6. Subdomínios 1.2 (conteúdo tóxico) e 4.3 (fraude com IA) cobertos em C03 e C11: perguntas I-29 e I-30, controles CT-29 a CT-31.
7. Regras do perfil em `perfil.json`; pergunta sobre decisão que afeta pessoas reescrita; quadro “O que suas respostas ativaram” no fim da E1.

Sessões exportadas pela 0.1.0 (`sessao/1`) continuam abrindo: a frequência é convertida (1–2 → nunca; 3–5 → já aconteceu) e o usuário responde as perguntas novas.

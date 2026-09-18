"use strict";

/* ============ criptografia: FNV-1a + splitmix64 + XOR ============ */
const MASK64 = (1n << 64n) - 1n;

function hashSenha(senha){
  const bytes = new TextEncoder().encode(senha);
  let h = 1469598103934665603n;
  for (const b of bytes){
    h = (h ^ BigInt(b)) & MASK64;
    h = (h * 1099511628211n) & MASK64;
  }
  if (h === 0n) h = 0x9E3779B97F4A7C15n;
  return h;
}

function proximoBloco(estado){
  let z = (estado.s = (estado.s + 0x9E3779B97F4A7C15n) & MASK64);
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function cifrar(dados, senha){
  const estado = { s: hashSenha(senha) };
  let i = 0;
  while (i < dados.length){
    const bloco = proximoBloco(estado);
    let baixo = Number(bloco & 0xFFFFFFFFn);
    let alto  = Number((bloco >> 32n) & 0xFFFFFFFFn);
    for (let b = 0; b < 8 && i < dados.length; b++, i++){
      const byte = b < 4 ? (baixo >>> (8*b)) & 0xFF : (alto >>> (8*(b-4))) & 0xFF;
      dados[i] ^= byte;
    }
  }
  return dados;
}

/* ============ árvore de Huffman ============ */
let contadorId = 0;
function novoNo(simbolo, folha, freq, esq, dir){
  return { id: contadorId++, simbolo, folha, freq, esq: esq||null, dir: dir||null };
}

function construirArvore(dados){
  const freq = new Array(256).fill(0);
  for (const b of dados) freq[b]++;

  let lista = [];
  for (let i = 0; i < 256; i++) if (freq[i] > 0) lista.push(novoNo(i, true, freq[i]));

  if (lista.length === 0) return { raiz: novoNo(0, true, 0), passos: [] };
  if (lista.length === 1) lista.push(novoNo(lista[0].simbolo === 0 ? 1 : 0, true, 0));

  lista.sort((a,b) => a.freq - b.freq || a.simbolo - b.simbolo);
  const passos = [{ floresta: lista.slice(), novo: null, texto:
    "Início: " + lista.length + " folhas, uma para cada símbolo diferente, ordenadas da menor para a maior frequência." }];

  while (lista.length > 1){
    let i1 = 0;
    for (let i = 1; i < lista.length; i++) if (lista[i].freq < lista[i1].freq) i1 = i;
    const a = lista.splice(i1,1)[0];
    let i2 = 0;
    for (let i = 1; i < lista.length; i++) if (lista[i].freq < lista[i2].freq) i2 = i;
    const b = lista.splice(i2,1)[0];

    const pai = novoNo(0, false, a.freq + b.freq, a, b);
    lista.push(pai);
    passos.push({
      floresta: lista.slice(), novo: pai,
      texto: "Junta " + rotulo(a) + " (" + a.freq + ") + " + rotulo(b) + " (" + b.freq +
             ") num nó interno de frequência " + pai.freq + ". Faltam " + (lista.length - 1) + " junções."
    });
  }
  return { raiz: lista[0], passos };
}

function rotulo(no){
  if (!no.folha) return "[nó " + no.freq + "]";
  return nomeSimbolo(no.simbolo);
}

function nomeSimbolo(s){
  if (s === 32) return "espaço";
  if (s === 10) return "\\n";
  if (s === 13) return "\\r";
  if (s === 9)  return "\\t";
  if (s >= 33 && s <= 126) return String.fromCharCode(s);
  return "0x" + s.toString(16).padStart(2,"0").toUpperCase();
}

function tabelaCodigos(raiz){
  const tab = {};
  (function anda(no, cod){
    if (!no) return;
    if (no.folha){ tab[no.simbolo] = cod.length ? cod : "0"; return; }
    anda(no.esq, cod + "0");
    anda(no.dir, cod + "1");
  })(raiz, "");
  return tab;
}

function codificar(dados, raiz){
  const tab = tabelaCodigos(raiz);
  let capacidade = dados.length * 2 + 16;
  let saida = new Uint8Array(capacidade);
  let bit = 0;
  for (const byte of dados){
    const cod = tab[byte];
    for (let j = 0; j < cod.length; j++){
      const idx = bit >> 3;
      if (idx >= capacidade){
        capacidade *= 2;
        const maior = new Uint8Array(capacidade);
        maior.set(saida); saida = maior;
      }
      if (cod[j] === "1") saida[idx] |= (1 << (7 - (bit & 7)));
      bit++;
    }
  }
  return { bytes: saida.subarray(0, (bit + 7) >> 3), bits: bit };
}

function decodificar(bytes, bits, raiz, tamanhoOriginal){
  const saida = new Uint8Array(tamanhoOriginal);
  if (raiz.folha){ saida.fill(raiz.simbolo); return saida; }
  let pos = 0, no = raiz;
  for (let i = 0; i < bits && pos < tamanhoOriginal; i++){
    const b = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    no = b ? no.dir : no.esq;
    if (!no) return null;
    if (no.folha){ saida[pos++] = no.simbolo; no = raiz; }
  }
  return saida;
}

/* serializa a árvore em pós-ordem: para um nó interno, primeiro grava
   a subárvore esquerda, depois a direita, e só então o próprio nó.
   Uma folha grava 1+símbolo; um nó interno grava 0 (seus filhos já
   foram gravados antes dele, pela ordem de visita). */
function serializarArvore(raiz){
  const out = [];
  (function anda(no){
    if (no.folha){ out.push(1, no.simbolo); }
    else { anda(no.esq); anda(no.dir); out.push(0); }
  })(raiz);
  return new Uint8Array(out);
}

/* reconstrói a árvore a partir da sequência em pós-ordem usando uma pilha:
   cada folha lida é empilhada; ao ler um nó interno, os dois nós do topo
   da pilha (o direito foi empilhado por último, o esquerdo antes dele)
   são desempilhados e viram filhos do novo nó, que volta para a pilha.
   Ao final, a pilha deve conter só a raiz. "ordem" registra a sequência
   em que os nós foram montados, para a animação. */
function desserializarArvore(buf){
  const pilha = [];
  const ordem = [];
  let pos = 0;
  while (pos < buf.length){
    const flag = buf[pos++];
    if (flag === 1){
      if (pos >= buf.length) return null;
      const no = novoNo(buf[pos++], true, 0);
      pilha.push(no);
      ordem.push(no);
    } else if (flag === 0){
      if (pilha.length < 2) return null;
      const dir = pilha.pop();
      const esq = pilha.pop();
      const no = novoNo(0, false, 0, esq, dir);
      pilha.push(no);
      ordem.push(no);
    } else {
      return null;
    }
  }
  if (pilha.length !== 1) return null;
  return { raiz: pilha[0], ordem, lidos: pos };
}

/* ============ formato .msg ============ */
const MAGIC = [80,80,77,83]; // "PPMS"

function escreverU32(arr, off, v){
  arr[off]   = v & 0xFF;
  arr[off+1] = (v >>> 8) & 0xFF;
  arr[off+2] = (v >>> 16) & 0xFF;
  arr[off+3] = (v >>> 24) & 0xFF;
}
function lerU32(arr, off){
  return (arr[off] | (arr[off+1] << 8) | (arr[off+2] << 16) | (arr[off+3] << 24)) >>> 0;
}

function empacotar(dados, senha){
  const { raiz, passos } = construirArvore(dados);
  const cod = codificar(dados, raiz);
  const arvore = serializarArvore(raiz);

  const tam = 4 + 4 + arvore.length + 4 + 4 + cod.bytes.length;
  const payload = new Uint8Array(tam);
  let off = 0;
  escreverU32(payload, off, dados.length); off += 4;
  escreverU32(payload, off, arvore.length); off += 4;
  payload.set(arvore, off); off += arvore.length;
  escreverU32(payload, off, cod.bits); off += 4;
  escreverU32(payload, off, cod.bytes.length); off += 4;
  payload.set(cod.bytes, off);

  cifrar(payload, senha);

  const arquivo = new Uint8Array(9 + tam);
  arquivo.set(MAGIC, 0);
  arquivo[4] = 1;
  escreverU32(arquivo, 5, tam);
  arquivo.set(payload, 9);

  return { arquivo, raiz, passos, cod, bitsOriginais: dados.length * 8 };
}

function desempacotar(arquivo, senha){
  if (arquivo.length < 9) return { erro: "Arquivo curto demais para ser um .msg válido." };
  for (let i = 0; i < 4; i++) if (arquivo[i] !== MAGIC[i])
    return { erro: "Este arquivo não é um .msg do PPMS." };

  const tam = lerU32(arquivo, 5);
  if (tam < 12 || 9 + tam > arquivo.length) return { erro: "Arquivo .msg corrompido ou incompleto." };

  const payload = arquivo.slice(9, 9 + tam);
  cifrar(payload, senha);

  let off = 0;
  const tamanhoOriginal = lerU32(payload, off); off += 4;
  const tamArvore = lerU32(payload, off); off += 4;
  if (tamArvore > tam || off + tamArvore + 8 > tam) return { erro: "senha" };

  const res = desserializarArvore(payload.subarray(off, off + tamArvore));
  off += tamArvore;
  if (!res) return { erro: "senha" };

  const bits = lerU32(payload, off); off += 4;
  const tamCod = lerU32(payload, off); off += 4;
  if (off + tamCod > tam || tamanhoOriginal > 200*1024*1024) return { erro: "senha" };

  const dados = decodificar(payload.subarray(off, off + tamCod), bits, res.raiz, tamanhoOriginal);
  if (!dados) return { erro: "senha" };

  return { dados, raiz: res.raiz, ordem: res.ordem, arvoreBytes: payload.slice(off - tamArvore - 8, off - 8) };
}

/* ============ desenho da árvore ============ */
const GAP_X = 58, GAP_Y = 62, MARGEM = 30;

function posicionar(raiz){
  let x = 0;
  const nos = [], arestas = [];
  (function anda(no, prof){
    if (no.folha){ no._x = x; x += GAP_X; }
    else {
      anda(no.esq, prof+1);
      anda(no.dir, prof+1);
      no._x = (no.esq._x + no.dir._x) / 2;
      arestas.push([no, no.esq, "0"], [no, no.dir, "1"]);
    }
    no._y = prof * GAP_Y;
    nos.push(no);
  })(raiz, 0);
  return { nos, arestas, largura: Math.max(x, GAP_X) };
}

function desenhar(svg, raizes, destaque, visiveis){
  let offset = 0, alturaMax = 0;
  const partes = [];
  for (const raiz of raizes){
    const { nos, arestas, largura } = posicionar(raiz);
    for (const n of nos){ n._x += offset; alturaMax = Math.max(alturaMax, n._y); }
    partes.push({ nos, arestas });
    offset += largura + GAP_X;
  }
  const larguraTotal = Math.max(offset, 400) + MARGEM;
  const alturaTotal = alturaMax + GAP_Y + MARGEM;

  let s = "";
  for (const { nos, arestas } of partes){
    for (const [pai, filho, bit] of arestas){
      if (visiveis && (!visiveis.has(pai.id) || !visiveis.has(filho.id))) continue;
      const mx = (pai._x + filho._x) / 2, my = (pai._y + filho._y) / 2;
      s += `<line x1="${pai._x + MARGEM}" y1="${pai._y + MARGEM + 14}" x2="${filho._x + MARGEM}" y2="${filho._y + MARGEM - 14}" stroke="#2f5878" stroke-width="1.6"/>`;
      s += `<text x="${mx + MARGEM - 9}" y="${my + MARGEM + 4}" fill="#6f8ca6" font-size="11" font-family="monospace">${bit}</text>`;
    }
    for (const n of nos){
      if (visiveis && !visiveis.has(n.id)) continue;
      const cor = n.folha ? "#f0b357" : "#5fc7bd";
      const aceso = destaque && destaque.has(n.id);
      s += `<circle cx="${n._x + MARGEM}" cy="${n._y + MARGEM}" r="${n.folha ? 15 : 13}" fill="${aceso ? cor : "#0d1a26"}" stroke="${cor}" stroke-width="${aceso ? 3 : 1.8}"/>`;
      const txt = n.folha ? nomeSimbolo(n.simbolo) : (n.freq ? String(n.freq) : "•");
      const tam = txt.length > 3 ? 8 : (txt.length > 1 ? 10 : 13);
      s += `<text x="${n._x + MARGEM}" y="${n._y + MARGEM + 4}" text-anchor="middle" font-size="${tam}" font-family="monospace" fill="${aceso ? "#06212a" : "#e6eef5"}">${escapar(txt)}</text>`;
      if (n.folha && n.freq > 0)
        s += `<text x="${n._x + MARGEM}" y="${n._y + MARGEM + 30}" text-anchor="middle" font-size="10" fill="#8fa9bf">${n.freq}</text>`;
    }
  }
  svg.setAttribute("viewBox", `0 0 ${larguraTotal} ${alturaTotal}`);
  svg.innerHTML = s;
}

function escapar(t){
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ============ animação genérica ============ */
function criarPlayer(svg, campoTexto, btnAnt, btnProx, btnPlay, slider, render){
  let passos = [], atual = 0, timer = null;

  function mostrar(){
    if (!passos.length) return;
    atual = Math.max(0, Math.min(atual, passos.length - 1));
    render(passos[atual]);
    campoTexto.textContent = "Passo " + (atual + 1) + " de " + passos.length + " — " + passos[atual].texto;
    btnAnt.disabled = atual === 0;
    btnProx.disabled = atual === passos.length - 1;
  }
  function parar(){ clearInterval(timer); timer = null; btnPlay.textContent = "Tocar"; }
  btnAnt.onclick = () => { parar(); atual--; mostrar(); };
  btnProx.onclick = () => { parar(); atual++; mostrar(); };
  btnPlay.onclick = () => {
    if (timer) return parar();
    if (atual === passos.length - 1) atual = 0;
    btnPlay.textContent = "Pausar";
    timer = setInterval(() => {
      if (atual >= passos.length - 1){ parar(); return; }
      atual++; mostrar();
    }, Number(slider.value));
  };
  slider.oninput = () => { if (timer){ parar(); btnPlay.click(); } };

  return {
    carregar(novos, tocar){
      parar();
      passos = novos; atual = 0; mostrar();
      if (tocar && passos.length > 1) btnPlay.click();
    }
  };
}

/* ============ histórico ============ */
const CHAVE_HIST = "ppms_historico";
function lerHistorico(){
  try { return JSON.parse(localStorage.getItem(CHAVE_HIST) || "[]"); } catch(e){ return []; }
}
function registrar(acao, arquivo, tamanho){
  const lista = lerHistorico();
  lista.unshift({ quando: new Date().toLocaleString("pt-BR"), acao, arquivo, tamanho });
  try { localStorage.setItem(CHAVE_HIST, JSON.stringify(lista.slice(0,200))); } catch(e){}
  renderHistorico();
}
function renderHistorico(){
  const lista = lerHistorico();
  const tab = document.getElementById("tab-hist");
  const vazio = document.getElementById("hist-vazio");
  const corpo = tab.querySelector("tbody");
  corpo.innerHTML = "";
  tab.hidden = lista.length === 0;
  vazio.hidden = lista.length > 0;
  for (const l of lista){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.quando}</td><td>${l.acao}</td><td>${escapar(l.arquivo)}</td><td>${l.tamanho} bytes</td>`;
    corpo.appendChild(tr);
  }
}

/* ============ utilidades de interface ============ */
function aviso(el, texto, tipo){
  el.hidden = false;
  el.className = "aviso" + (tipo ? " " + tipo : "");
  el.textContent = texto;
}
function baixar(bytes, nome){
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function hexDump(bytes, limite){
  const n = Math.min(bytes.length, limite);
  let s = "";
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2,"0") + (i % 16 === 15 ? "\n" : " ");
  if (bytes.length > n) s += "\n... (+" + (bytes.length - n) + " bytes)";
  return s;
}
function lerArquivo(input){
  return new Promise((ok, falha) => {
    const f = input.files && input.files[0];
    if (!f) return falha(new Error("nenhum arquivo"));
    const fr = new FileReader();
    fr.onload = () => ok({ bytes: new Uint8Array(fr.result), nome: f.name });
    fr.onerror = () => falha(new Error("falha na leitura"));
    fr.readAsArrayBuffer(f);
  });
}

/* ============ abas ============ */
document.querySelectorAll(".aba").forEach(aba => {
  aba.onclick = () => {
    document.querySelectorAll(".aba").forEach(a => {
      a.setAttribute("aria-selected", String(a === aba));
      document.getElementById(a.dataset.alvo).hidden = a !== aba;
    });
  };
});

/* ============ fluxo: criptografar ============ */
const svgC = document.getElementById("svg-c");
const playerC = criarPlayer(
  svgC, document.getElementById("c-passo"),
  document.getElementById("c-ant"), document.getElementById("c-prox"),
  document.getElementById("c-play"), document.getElementById("c-vel"),
  passo => desenhar(svgC, passo.floresta, passo.novo ? new Set([passo.novo.id]) : null)
);

document.getElementById("modo").onchange = e => {
  const arquivo = e.target.value === "arquivo";
  document.getElementById("bloco-texto").hidden = arquivo;
  document.getElementById("bloco-arquivo").hidden = !arquivo;
};

document.getElementById("btn-limpar-c").onclick = () => {
  document.getElementById("msg").value = "";
  document.getElementById("senha-c").value = "";
  document.getElementById("aviso-c").hidden = true;
  document.getElementById("box-arvore-c").hidden = true;
};

document.getElementById("btn-crip").onclick = async () => {
  const avisoEl = document.getElementById("aviso-c");
  const senha = document.getElementById("senha-c").value;
  let nome = document.getElementById("saida").value.trim() || "mensagem.msg";
  if (!nome.toLowerCase().endsWith(".msg")) nome += ".msg";

  if (!senha) return aviso(avisoEl, "Defina uma senha antes de criptografar.", "erro");

  let dados, origem;
  if (document.getElementById("modo").value === "texto"){
    const txt = document.getElementById("msg").value;
    if (!txt) return aviso(avisoEl, "Escreva a mensagem que você quer enviar.", "erro");
    dados = new TextEncoder().encode(txt);
    origem = "texto";
  } else {
    try {
      const f = await lerArquivo(document.getElementById("arq-entrada"));
      dados = f.bytes; origem = f.name;
    } catch(e){ return aviso(avisoEl, "Escolha o arquivo que você quer criptografar.", "erro"); }
    if (dados.length > 2 * 1024 * 1024)
      return aviso(avisoEl, "Arquivo grande demais para a animação da árvore. Use até 2 MB.", "erro");
  }

  const r = empacotar(dados, senha);
  baixar(r.arquivo, nome);
  registrar(origem === "texto" ? "Enviado (texto)" : "Enviado (arquivo)", nome, dados.length);

  const bitsCod = r.cod.bits;
  aviso(avisoEl,
    `Pronto: ${nome} foi baixado. Original ${dados.length} bytes; codificado pela árvore em ${Math.ceil(bitsCod/8)} bytes; arquivo final ${r.arquivo.length} bytes (com árvore e cabeçalho). Passe a senha para o destinatário por fora.`,
    "ok");

  document.getElementById("box-arvore-c").hidden = false;
  playerC.carregar(r.passos, true);

  const tab = tabelaCodigos(r.raiz);
  const corpo = document.querySelector("#tab-cod tbody");
  corpo.innerHTML = "";
  const freqs = {};
  for (const b of dados) freqs[b] = (freqs[b] || 0) + 1;
  Object.keys(tab).sort((a,b) => (freqs[b]||0) - (freqs[a]||0)).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapar(nomeSimbolo(Number(s)))}</td><td>${freqs[s] || 0}</td><td class="cod">${tab[s]}</td>`;
    corpo.appendChild(tr);
  });
  document.getElementById("hex-c").textContent = hexDump(r.arquivo, 256);
};

/* ============ fluxo: descriptografar ============ */
const svgD = document.getElementById("svg-d");
const playerD = criarPlayer(
  svgD, document.getElementById("d-passo"),
  document.getElementById("d-ant"), document.getElementById("d-prox"),
  document.getElementById("d-play"), document.getElementById("d-vel"),
  passo => desenhar(svgD, [passo.raiz], new Set([passo.destaque]), passo.visiveis)
);

let ultimoResultado = null;

document.getElementById("btn-descrip").onclick = async () => {
  const avisoEl = document.getElementById("aviso-d");
  const senha = document.getElementById("senha-d").value;
  document.getElementById("resultado").hidden = true;
  document.getElementById("box-arvore-d").hidden = true;

  let arq;
  try { arq = await lerArquivo(document.getElementById("arq-msg")); }
  catch(e){ return aviso(avisoEl, "Escolha o arquivo .msg que você recebeu.", "erro"); }
  if (!senha) return aviso(avisoEl, "Digite a senha combinada com quem enviou.", "erro");

  const r = desempacotar(arq.bytes, senha);
  if (r.erro === "senha")
    return aviso(avisoEl, "A senha não abriu este arquivo. Confirme a senha com quem enviou e tente de novo.", "erro");
  if (r.erro) return aviso(avisoEl, r.erro, "erro");

  ultimoResultado = { dados: r.dados, nome: arq.nome.replace(/\.msg$/i, "") };
  registrar("Recebido", arq.nome, r.dados.length);

  let texto;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(r.dados);
  } catch(e){ texto = null; }

  aviso(avisoEl, `Arquivo aberto: ${r.dados.length} bytes recuperados.`, "ok");
  document.getElementById("resultado").hidden = false;
  document.getElementById("texto-saida").value = texto !== null
    ? texto
    : "(conteúdo binário — não é texto. Use o botão abaixo para salvar o arquivo original.)";
  document.getElementById("info-orig").textContent = texto !== null
    ? "Se o conteúdo era um arquivo e não texto, salve-o pelo botão acima."
    : "";

  // passos da reconstrução: revela os nós na ordem em que foram lidos
  const visiveis = new Set();
  const passos = r.ordem.map((no, i) => {
    visiveis.add(no.id);
    return {
      raiz: r.raiz,
      destaque: no.id,
      visiveis: new Set(visiveis),
      texto: no.folha
        ? `byte 1 → folha com o símbolo "${nomeSimbolo(no.simbolo)}"`
        : "byte 0 → nó interno: desempilha os dois últimos nós montados e os torna seus filhos"
    };
  });
  passos.push({ raiz: r.raiz, destaque: -1, visiveis: new Set(visiveis),
    texto: "Árvore completa. Agora os bits recebidos são percorridos do topo para baixo (0 à esquerda, 1 à direita) e cada folha alcançada devolve um caractere da mensagem original." });

  document.getElementById("box-arvore-d").hidden = false;
  playerD.carregar(passos, true);
};

document.getElementById("btn-baixar-orig").onclick = () => {
  if (!ultimoResultado) return;
  const nome = ultimoResultado.nome.includes(".") ? ultimoResultado.nome : ultimoResultado.nome + ".txt";
  baixar(ultimoResultado.dados, nome);
};

/* ============ início ============ */
document.getElementById("btn-limpar-h").onclick = () => {
  try { localStorage.removeItem(CHAVE_HIST); } catch(e){}
  renderHistorico();
};
renderHistorico();

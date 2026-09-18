# PPMS — Mensagens Ponta a Ponta

Aplicação web (HTML/CSS/JS puros, sem dependências) para trocar mensagens ou arquivos criptografados por meio físico (ex.: pendrive), com a árvore de Huffman usada na compressão animada passo a passo na tela.

Formato de arquivo `.msg` compatível com uma versão original do programa em C (mesmo cabeçalho `PPMS`).

## Como usar

1. Baixe os três arquivos (`index.html`, `style.css`, `script.js`) na mesma pasta — não precisa instalar nada, só abrir o `index.html` no navegador.
2. Na aba **Criptografar**, escreva a mensagem (ou selecione um arquivo), defina uma senha e clique em **Criptografar e baixar .msg**.
3. Combine a senha com quem vai receber por outro canal (ela nunca é gravada dentro do arquivo).
4. Leve os arquivos e o `.msg` gerado no pendrive (ou envie por qualquer outro meio).
5. No outro computador, abra o mesmo `index.html`, vá em **Descriptografar**, selecione o `.msg` e digite a senha.

A aba **Como usar**, dentro da própria aplicação, repete esse passo a passo.

## Como funciona por dentro

1. Conta a frequência de cada byte da mensagem/arquivo.
2. Monta a árvore de Huffman juntando sempre os dois nós de menor frequência — essa montagem é a animação exibida na tela.
3. Substitui cada byte pelo caminho correspondente na árvore (0 = esquerda, 1 = direita), gerando uma sequência de bits.
4. Serializa a árvore em **pós-ordem** (filho esquerdo, filho direito e só então o nó pai) e empacota tudo: tamanho original, árvore serializada e os bits codificados.
5. Cifra o pacote inteiro com um fluxo de bytes pseudoaleatório (gerador `splitmix64`, semeado a partir de um hash `FNV-1a` da senha), aplicado por XOR.

No lado de quem recebe, o processo é revertido: decifra o pacote e reconstrói a árvore lendo a sequência em pós-ordem com uma pilha — cada folha lida é empilhada, e cada nó interno lido desempilha os dois últimos nós montados para virarem seus filhos, empilhando o resultado. Ao final resta só a raiz. Essa reconstrução também é animada, e depois a árvore é percorrida bit a bit para recuperar os dados originais.

### Observação sobre segurança

A árvore de Huffman aqui serve para **compressão**, não para criptografia. Quem garante o sigilo é a cifra por XOR/`splitmix64` aplicada sobre o pacote já compactado. É uma cifra didática, adequada para fins de estudo e demonstração — mais fraca que um algoritmo padrão de mercado como AES-256, que seria a escolha em um sistema de produção real.

## Estrutura do repositório

```
.
├── index.html   # estrutura da página
├── style.css    # estilos
├── script.js    # lógica: cifra, árvore de Huffman, empacotamento do .msg, animações
├── LICENSE
└── README.md
```

## Tecnologias

- HTML, CSS e JavaScript puros (sem frameworks, sem etapa de build)
- SVG gerado dinamicamente para desenhar a árvore de Huffman
- `localStorage` do navegador apenas para o histórico local de mensagens (não sai da máquina)

## Autores

- Yago Correa
- João Victor Oliveira
- Gustavo França Mendes
- Guilherme Ramos Rangel
- Cairo Gomes

## Licença

Distribuído sob a licença MIT — veja [LICENSE](LICENSE).

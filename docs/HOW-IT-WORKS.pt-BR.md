# Como o MLO Creator Funciona

Este documento serve como referência técnica detalhada sobre como cada módulo do programa opera e como a ferramenta foi construída. O [README.pt-BR.md](../README.pt-BR.md) cobre os requisitos de instalação e execução.

## Índice

1. [Arquitetura](#arquitetura)
2. [Tipos de Projeto](#tipos-de-projeto)
3. [Fluxo de Trabalho: Interior em Modelo Importado](#fluxo-de-trabalho-interior-em-modelo-importado)
4. [Sistema de Coordenadas](#sistema-de-coordenadas)
5. [Corte do Modelo e da Colisão](#corte-do-modelo-e-da-colisão)
6. [Portas e Janelas](#portas-e-janelas)
7. [Props e Vegetação](#props-e-vegetação)
8. [Múltiplos Prédios em um Único Projeto](#múltiplos-prédios-em-um-único-projeto)
9. [Exportação (Resource FiveM)](#exportação-resource-fivem)
10. [Limitações Conhecidas](#limitações-conhecidas)
11. [Construção de Edifício Novo do Zero](#construção-de-edifício-novo-do-zero)
12. [Controles e Atalhos de Teclado](#controles-e-atalhos-de-teclado)
13. [Mapa do Código-Fonte](#mapa-do-código-fonte)

## Arquitetura

- `MloCreator.exe` é um programa em C# 5 (.NET Framework, compilado com o `csc.exe` nativo do Windows). Ele inicia um pequeno servidor HTTP em `127.0.0.1` com um token aleatório de segurança e serve o editor a partir da pasta `ui\` no disco.
- O editor é uma página WebGL exibida em uma janela nativa (`AppWindow.cs`, WinForms com Microsoft WebView2). Caso o WebView2 esteja ausente, o programa recorre a uma janela `--app` do Edge ou Chrome; `logs\window.log` registra o diagnóstico.
- A página web gerencia o projeto (um arquivo JSON em `projects\`), executa todas as ferramentas de edição, constrói as malhas (meshes) e colisões do interior, e envia um descritivo completo para o host C# no momento da exportação.
- O host C# realiza tudo o que exige arquivos do jogo: leitura de `.ydr`, `.yft`, `.ybn`, `.ytd`, `.ytyp`, `.ymap` e arquivos RPF do jogo através da biblioteca do CodeWalker, recorte das malhas e colisões, e escrita dos arquivos do resource.
- Ao fechar a janela, o programa é encerrado; trabalhos não salvos são gravados antes da saída. Os projetos também contam com salvamento automático (autosave).

Como a interface é servida diretamente do disco, qualquer alteração em `ui\` exige apenas recarregar a página no navegador; já alterações em `src\` exigem recompilar via `build.ps1`.

## Tipos de Projeto

- **Interior em Modelo Importado:** Importe os arquivos de um edifício, faça as aberturas, desenhe as salas, finalize os acabamentos e exporte. Este é o fluxo de trabalho principal e está descrito abaixo.
- **Edifício Novo Completo:** Projete uma casa inteira do zero sobre uma grade com paredes, cômodos, portas, janelas, escadas, múltiplos pavimentos e telhado.
- **Interior para Casa Existente (Legado):** Projetos criados no modo automático inicial continuam abrindo e exportando normalmente.

## Fluxo de Trabalho: Interior em Modelo Importado

A aba **Build** apresenta uma rota composta por 9 etapas que se abrem como menus expansíveis; um card superior indica seu progresso e a próxima ação sugerida:

1. **Importar o Modelo:** Adicione os arquivos `.ydr`, `.ytd`, `.ybn` e `.ymap`, ou busque-os diretamente nos arquivos do jogo. O maior arquivo `.ydr` corresponde ao modelo. Indique onde o modelo fica posicionado no mapa do GTA V (lendo de um `.ymap` importado, pesquisando nos arquivos ou digitando as coordenadas x, y, z e heading).
2. **Configurar o Edifício:** Modelos do jogo geralmente englobam quarteirões inteiros. A ferramenta *Select building* detecta os objetos isolados do modelo (vértices coincidentes pertencem ao mesmo prédio), oculta o restante, alinha a grade às paredes e posiciona a câmera. A ferramenta *Frame* alinha a grade à parede clicada; Shift+clique define a altura do piso; Alt+clique reposiciona o canto base.
3. **Desenhar os Cômodos:**
   - *Add room:* Desenha um retângulo (piso, paredes e teto).
   - *Cut out:* Subtrai uma área retangular de um cômodo existente.
   - *Partition:* Desenha uma parede divisória interna.
   - *Select:* Edita qualquer elemento através de alças de redimensionamento.
   - As bordas possuem snap magnético com as paredes do modelo e com a grade a cada 5 cm. A ferramenta *Fit rooms to the walls* ajusta automaticamente todas as bordas dos cômodos às faces internas das paredes do prédio.
4. **Portas e Janelas:** As ferramentas *Door*, *Window* e *Archway* cortam através do modelo; a ferramenta *Models* insere e posiciona modelos de portas e janelas a partir de arquivos `.glb` próprios.
5. **Limpar o Modelo:** Deleta faces, partes indesejadas do modelo, fecha buracos em arestas (*Edges*), remove pedaços de colisão originais e permite criar caixas de colisão personalizadas. Partes do modelo que invadem o interior das salas são limpas automaticamente.
6. **Props e Remoções Pontuais:** Localiza arbustos, árvores e outros props posicionados pelo mapa ao redor do prédio, exibe-os na viewport e permite remover os que você selecionar (gerando um script client leve).
7. **Acabamento Interno:** Aplicação de pintura e materiais em pisos e paredes com texturas embutidas ou importadas, posicionamento de luzes de teto e manequim de escala humana.
8. **Validação:** Checklist de integridade e teste de navegação a pé (*Walk check*).
9. **Exportação:** Geração do pacote FiveM final.

### Configurações dos Cômodos

- **Altura do teto (Ceiling height)** e **profundidade de parede (wall depth)** ficam no painel lateral direito. *Match the building* seleciona a altura de teto predominante na área de parede do próprio edifício.
- **Espessura da parede (Wall thickness):** Desloca a face interna das paredes para dentro do cômodo, cobrindo pequenas imperfeições ou saliências da carcaça do prédio. Os cantos se encontram suavemente nas faces deslocadas e os vãos ganham requadros (revelações).
- **Paredes internas:** Podem ser geradas a partir das bordas dos cômodos (padrão) ou utilizando as faces internas originais do edifício invertidas para olhar para dentro (experimental).

### Ferramentas em Destaque

| Ferramenta | Descrição |
|---|---|
| Select building | Isola os objetos de um único edifício dentre um modelo que contenha múltiplos prédios |
| Frame | Alinha a grade ortogonalmente a uma parede; define a altura do piso e o canto de ancoragem |
| Raise / lower rooms | Move todos os cômodos verticalmente para cima ou para baixo em relação ao modelo |
| Add room, Cut out, Partition | Ferramentas essenciais de desenho da planta do interior |
| Fill gaps | Preenche vãos vazios de piso entre cômodos adjacentes |
| Door, Window, Archway | Corta aberturas através da malha do modelo, da colisão física e das paredes do interior |
| Models | Insere modelos 3D de esquadrias e portas a partir de arquivos `.glb` |
| Delete faces, Model parts | Remove polígonos ou blocos inteiros da geometria original do edifício |
| Edges (Fill holes) | Fecha orifícios na carcaça do modelo original |
| Collision | Deleta blocos de colisão física original e gera caixas de colisão customizadas |
| Props and plants | Identifica entidades do mapa do GTA V ao redor do prédio e oculta itens selecionados |
| Floor and wall paint | Aplica texturas e cores em pisos e paredes |
| Ceiling lights | Insere pontos de luz artificiais de teto no interior do MLO |
| Checklist & Walk check | Validação prévia de integridade e teste de colisão com cápsula navegável |

## Sistema de Coordenadas

O editor utiliza o mesmo sistema de eixos tridimensional do GTA V:
- **X:** Leste (+) / Oeste (-)
- **Y:** Norte (+) / Sul (-)
- **Z:** Altura vertical (Cima / Baixo)
- **Heading:** Rotação angular em torno do eixo Z (em graus).

## Corte do Modelo e da Colisão

Quando uma abertura é posicionada:
1. Uma caixa de corte tridimensional é delimitada pela posição, largura, altura e profundidade configuradas.
2. Na exportação, o algoritmo C# realiza uma operação booleana sobre a malha geométrica (`.ydr`), dividindo polígonos que intersectam o volume, removendo as faces internas do vão e recalculando normais e texturas.
3. A mesma operação é replicada sobre a malha de colisão física correspondente (`.ybn`), recortando polígonos de colisão para que tanto o personagem quanto projéteis atravessem livremente a abertura sem barreiras invisíveis.

## Portas e Janelas

### Tipos de Recorte
- **Door (Porta):** Abertura padrão de passagem do piso ao topo.
- **Window (Janela):** Abertura com soleira e peitoril para aplicação de vidros transparentes (`<prefix>_glass.ydr`).
- **Archway (Arco):** Vão livre vazado sem rebaixos ou batentes.

### Modelos de Portas e Janelas a partir de arquivos `.glb`
- Você pode carregar modelos em formato GLB/glTF com suas esquadrias, folhas de porta e vidros.
- O MLO Creator converte as malhas para arquivos compatíveis com o FiveM (`_fm*.ydr`, `_fd*.ydr`) e registra os arquétipos no manifesto de interiores (`.ytyp`).

### Como uma Porta é Exportada
Props de portas dinâmicas são registrados como arquétipos estáticos na posição inicial. Para permitir trancar/destrancar ou abrir suavemente pelo jogador, configure o nome do modelo gerado e suas coordenadas no script de portas do seu servidor (por exemplo, `ox_doorlock` ou `qb-doorlock`).

## Props e Vegetação

Edifícios do GTA V frequentemente possuem arbustos, latas de lixo e postes vinculados ao `.ymap` original daquela vizinhança.
- A ferramenta lê essas entradas diretamente dos arquivos do mapa.
- Exibe os objetos na viewport 3D para que você possa inspecioná-los.
- Marca as entidades selecionadas para exclusão e gera o arquivo `client/plants.lua`, que instrui o FiveM a ocultar esses props durante a execução do resource.

## Múltiplos Prédios em um Único Projeto

Se o seu arquivo `.ydr` incluir mais de uma casa ou condomínio, você pode trabalhar em múltiplos edifícios no mesmo projeto. Cada prédio terá sua própria grade, cômodos, divisórias, luzes, caixas de colisão, acabamentos e texturas. O modelo base, faces deletadas e posicionamento global são compartilhados. No momento da exportação, cada prédio se torna um interior MLO independente (`<prefix>int.ydr`, `<prefix>mlo.ybn`, ...) indexado pelo número do edifício.

## Exportação (Resource FiveM)

Ao pressionar **Export** na aba de exportação, o diretório é gerado em `output\<nome_do_projeto>`. Basta copiar a pasta para o diretório `resources/` do seu servidor e adicionar `ensure <nome_do_projeto>` no `server.cfg`.

| Arquivo | Finalidade |
|---|---|
| `<prefix>_int.ydr` | Geometria 3D do interior (pisos, paredes, teto, acabamentos e iluminação). |
| `<prefix>_glass.ydr` | Vidros transparentes com shader específico de reflexo. |
| `<prefix>_mlo.ybn` | Colisão física de pisos, paredes e caixas personalizadas. |
| `<prefix>_tex.ytd` | Dicionário contendo apenas as texturas efetivamente utilizadas no interior. |
| `<prefix>_types.ytyp` | Definição técnica do MLO: sala de limbo + sala do interior, portais de oclusão visual para cada porta/janela externa e props de portas. |
| `<prefix>_milo_.ymap`, `_manifest_<prefix>.ymf` | Posicionamento no mapa global do GTA V e marcadores de ativação do MLO. |
| Modelo `.ydr` do prédio | O modelo vanilla original com os recortes das aberturas aplicados, exportado sob o nome original para substituir o arquivo do jogo enquanto o resource estiver ativo. |
| Arquivos `.ybn` importados | As colisões do jogo com os mesmos recortes físicos. |
| Arquivos de oclusão `.ymap` | Mesmos arquivos do jogo sem caixas de oclusão antigas que pudessem causar desaparecimento de objetos dentro do MLO. |
| `_fm*.ydr`, `_fd*.ydr` | Componentes de janelas e portas gerados a partir dos modelos `.glb`. |
| `client/plants.lua` | Script Lua client-side para ocultar a vegetação e props conflitantes. |
| `fxmanifest.lua`, `client/ipl.lua`, `README.md` | Manifesto oficial do resource, carregador de IPL e guia de testes com coordenadas de teleporte. |

## Limitações Conhecidas

- **Testes In-Game são Indispensáveis:** Nunca presuma que o MLO está 100% pronto sem testá-lo no jogo. O streaming de texturas, iluminação dinâmica, portais de visibilidade, colisão e interação de portas precisam ser conferidos dentro do FiveM.
- **Substituição de Arquivos Vanilla:** Apenas um resource pode substituir um mesmo arquivo `.ydr` ou `.ybn` do jogo por vez.
- **Geometria de Salas:** Os cômodos são retângulos bidimensionais alinhados à grade local.
- **Alinhamento para Cortes Internos:** Recortes nas paredes do interior só abrem passagens quando alinhados ortogonalmente à grade (tolerância de até 1.5 graus); o modelo externo e as colisões físicas podem ser recortados em qualquer ângulo.
- **Primitivas de Colisão Complexas:** Esferas, cápsulas e cilindros presentes na colisão original não são fatiados booleana por booleana (polígonos são).
- **Caixas de Colisão:** Caixas manuais desenhadas são volumes geométricos simples e não possuem checagem automática contra outras geometrias.
- **Teste de Caminhada (Walk check):** Testa a colisão dos arquivos gerados com uma cápsula simplificada em nível horizontal plano, não substituindo o controlador de movimento dinâmico do personagem do GTA V.
- **Portas Estáticas:** Props de portas são exportados na posição neutra estática. Para torná-las funcionais, conecte-as ao seu script de trancas (doorlock) por modelo e coordenadas.
- **Texturas Não Importadas:** Texturas que não estejam presentes nos arquivos importados aparecem com cores sólidas provisórias no editor; no jogo, a engine usa as texturas nativas do GTA V.
- **Inclinação e Escala do Modelo:** A inclinação (tilt) do modelo é ignorada (apenas a rotação em torno do eixo Z vertical é considerada); a escala do modelo precisa ser 1.0.

## Construção de Edifício Novo do Zero

| Ferramenta | Ação |
|---|---|
| Wall | Desenha paredes arrastando de um vértice da grade ao outro |
| Room | Desenha um retângulo definindo quatro paredes e piso |
| Floor | Preenche células selecionadas apenas com piso |
| Door, Window, Archway | Clique em uma parede para criar a abertura; clique novamente para removê-la |
| Stairs | Clique em uma célula para adicionar escada (degraus, largura, direção e corrimãos) |
| Roof | Cria laje de teto plana |
| Light | Posiciona ponto de luz artificial no forro |
| Entrance | Define a porta principal cujas coordenadas definirão a posição da casa no jogo |
| Eraser | Remove paredes e células selecionadas |

Fique no vão da porta de entrada dentro do jogo e copie o vetor `vec4(x, y, z, heading)` para definir a posição do imóvel.

## Controles e Atalhos de Teclado

- **Câmera:**
  - Botão do meio arrastado: Orbita a câmera (Shift + Botão do meio faz Pan; Ctrl + Botão do meio dá Zoom).
  - Botão direito arrastado: Também orbita a câmera.
  - Roda do mouse: Zoom in / Zoom out.
  - Teclado Numérico 1 / 3 / 7: Vista Frontal / Direita / Topo (pressione Ctrl junto para a vista oposta).
  - WASD: Movimenta a câmera livremente.
  - Q / E: Gira a visão em 90 graus.
  - Home: Enquadra todo o projeto na tela.
  - T: Vista superior ortogonal (Top-down).

- **Atalhos Gerais:**
  - `Ctrl + Z` / `Ctrl + Y`: Desfazer / Refazer.
  - `Esc` ou Botão Direito: Cancela a operação atual.
  - `Ctrl + S`: Salva o projeto.
  - A barra inferior exibe as teclas de atalho da ferramenta ativa no momento.

- **Teclas das Ferramentas:**
  - `1`: Add room
  - `2`: Cut out
  - `3`: Partition
  - `4`: Door
  - `5`: Window
  - `6`: Archway
  - `7`: Floor paint
  - `L`: Light
  - `V`: Select
  - `X`: Eraser
  - `B`: Select building
  - `O`: Frame
  - `G`: Raise / lower
  - `J`: Fill gaps
  - `F`: Delete faces
  - `P`: Model parts
  - `K`: Edges
  - `M`: Collision
  - `N`: Collision box
  - `I`: Window / door models
  - `Y`: Props and plants
  - `U`: Walk check
  - `H`: Scale figure
  - `C`: Cutaway

## Mapa do Código-Fonte

| Arquivo / Pasta | Conteúdo e Responsabilidade |
|---|---|
| `src\Program.cs` | Servidor local, rotas HTTP, configurações e inicialização da janela. |
| `src\AppWindow.cs` | Janela nativa com integração WebView2. |
| `src\ImportHost.cs` | Endpoints de importação, busca nos arquivos do jogo, coordenadas e props. |
| `src\ModelCut.cs`, `src\CollisionCut.cs` | Algoritmos de corte booleano na malha 3D e colisão física. |
| `src\Vanilla.cs` | Leitura de arquivos RPF e mapas originais do GTA V via CodeWalker. |
| `src\Exporter.cs`, `src\FitExport.cs` | Geração do resource FiveM, manifesto de tipos (`.ytyp`) e props. |
| `src\GlbModels.cs` | Leitura e conversão de modelos 3D `.glb`. |
| `ui\js\importmodel.js`, `importtools.js`, `importui.js` | Lógica da interface para o fluxo de importação e ferramentas. |
| `ui\js\plants.js` | Manipulação e exibição de props e vegetação. |
| `ui\js\shell.js`, `mesher.js` | Geração de malhas 3D e colisões do interior no navegador. |
| `ui\js\fitmodels.js` | Posicionamento de modelos `.glb`. |
| `ui\js\walk.js` | Sistema de teste de colisão a pé na viewport. |

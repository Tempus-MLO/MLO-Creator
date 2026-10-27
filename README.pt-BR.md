# MLO Creator

Um programa para Windows focado na criação de interiores customizados para FiveM (MLOs) dentro de modelos de edifícios existentes do GTA V, exportando diretamente uma pasta de resource pronta para o servidor.

Você importa os arquivos de modelo de um prédio (por exemplo, uma casa vanilla do jogo), corta portas e janelas através de suas paredes, constrói os cômodos internos, posiciona luzes e portas, aplica texturas e clica em **Export**. Nada é gerado de forma aleatória: cada parede, abertura, iluminação e recorte é fruto do que você projetou. O programa roda localmente no seu computador, fora do jogo.

> **Status:** Tudo o que o programa gera carrega com sucesso no [CodeWalker](https://github.com/dexyfex/CodeWalker) e os arquivos de saída são verificados um a um. No entanto, streaming de texturas, iluminação, portais, colisões e o comportamento de abertura de portas ainda precisam ser validados dentro do jogo. Relate nos issues qualquer comportamento inesperado.

## O que ele faz

- **Importação:** Suporta modelos `.ydr`, dicionários de textura `.ytd`, colisões `.ybn` e arquivos de posicionamento `.ymap` (com busca direta na sua própria instalação do GTA V).
- **Enquadramento e Alinhamento:** Ajusta a grade ao edifício e permite **desenhar cômodos**, recortes e divisórias internas.
- **Corte de Portas, Janelas e Vãos:** Recorta tanto a geometria visual do modelo quanto sua malha de colisão física (similar a uma operação booleana no Blender).
- **Modelos de Portas e Janelas:** Permite importar e posicionar seus próprios modelos em formato `.glb`, incluindo suporte a portas duplas.
- **Limpeza do Modelo Original:** Delete faces internas, remova partes do modelo original, tampe buracos, limpe paredes que invadem os cômodos e ajuste ou crie caixas de colisão personalizadas.
- **Props e Vegetação:** Localiza arbustos, árvores e objetos colocados pelo mapa ao redor do edifício, exibe-os na viewport e remove os selecionados (gerando automaticamente um script client para ocultá-los).
- **Acabamento Interno:** Pintura de pisos e paredes usando texturas embutidas ou externas, posicionamento de luzes de teto e manequim de escala.
- **Checagem e Validação:** Checklist de integridade, teste de navegação a pé (walk-through de colisão) e **exportação em um clique** para um resource com `fxmanifest.lua`, `client/ipl.lua` e um `README` listando todos os arquivos substituídos e as coordenadas de teleporte para testes.

O programa também inclui um modo secundário para criar casas do zero em uma grade. Detalhes de cada ferramenta estão disponíveis em [docs/HOW-IT-WORKS.pt-BR.md](docs/HOW-IT-WORKS.pt-BR.md).

## Requisitos do Sistema

- Windows 10 ou 11 (64-bit) com **.NET Framework 4.8** (já incluso no Windows).
- **[Runtime do Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)** (já presente nativamente no Windows 11 e no navegador Edge). Caso ausente, o programa recorrerá a uma janela de aplicativo do Edge/Chrome.
- Uma cópia instalada do GTA V e o **[CodeWalker](https://github.com/dexyfex/CodeWalker)** para extrair os arquivos do jogo.
- O programa detecta automaticamente instalações da Steam, Rockstar Games Launcher e Epic Games. Caso utilize outro diretório, defina `{"gtaPath": "D:\\Jogos\\Grand Theft Auto V"}` no arquivo `settings.json` ao lado do executável ou configure a variável de ambiente `GTA5_PATH`.

*Nenhum arquivo protegido por direitos autorais do GTA V está incluído no repositório. Você deve extrair os modelos que deseja modificar.*

## Como Obter os Arquivos do GTA V (CodeWalker obrigatório)

O MLO Creator trabalha com os arquivos extraídos do jogo: o modelo do edifício (`.ydr`), texturas (`.ytd`), colisões (`.ybn`) e posicionamento no mapa (`.ymap`). **Você precisará do [CodeWalker](https://github.com/dexyfex/CodeWalker) para extraí-los.**

1. Abra a pasta do seu GTA V no CodeWalker.
2. Localize o edifício desejado através do **RPF Explorer** ou da visualização de mundo (**World View**).
3. Extraia esses arquivos para seu computador.
4. No MLO Creator, acesse a aba **Import** e adicione os arquivos (botões *Add files*, *Add a folder* ou simplesmente arrastando-os para a janela).

O MLO Creator também utiliza as bibliotecas internas do CodeWalker para ler e escrever os formatos do jogo.

## Como Executar

1. Baixe o release e descompacte em qualquer pasta onde você tenha permissão de escrita.
2. Dê um duplo clique em `MloCreator.exe`.
3. Os projetos, cache, configurações e exports ficam salvos na pasta do programa (`projects\`, `cache\`, `output\`, `settings.json`).
4. Como o executável não possui assinatura digital paga, o Windows SmartScreen pode exibir um aviso na primeira inicialização ("Mais informações" -> "Executar assim mesmo").

**Parâmetros de Linha de Comando:**
- `--browser`: Força a abertura em uma janela de aplicativo do Edge ou Chrome.
- `--devtools`: Habilita o console de desenvolvedor (F12).
- `--no-window`: Executa apenas o servidor local (para testes headless).
- `--port N`: Define uma porta específica.

## Compilação a partir do Código-Fonte

Você precisa do Windows e do compilador C# nativo do .NET Framework (`csc.exe`, já embutido no Windows, sem necessidade de SDK pesado).

1. Coloque as DLLs necessárias na pasta `lib\` (leia [lib/README.md](lib/README.md)): DLLs do CodeWalker e WebView2 via `tools\fetch-webview2.ps1`.
2. Execute no PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File build.ps1
   ```
   *(Use `-CodeWalker <caminho>` para copiar as DLLs na primeira vez).*
3. Para gerar o pacote de distribuição:
   ```powershell
   powershell -ExecutionPolicy Bypass -File package.ps1
   ```

A interface do editor é construída puramente em **HTML, CSS e JavaScript** na pasta `ui\` (WebGL nativo, sem frameworks pesados ou etapas de build). Como ela é servida diretamente do disco, para ver alterações na interface basta recarregar a página (F5 ou Ctrl+R). Modificações no código C# (`src\*.cs`) exigem rodar o `build.ps1` novamente.

Para verificar se os arquivos exportados estão 100% íntegros:
```powershell
tools\verify_export.ps1 -Res <pasta_exportada>
```

## Estrutura do Projeto

| Pasta | Descrição |
|---|---|
| `src\` | Código C#: servidor HTTP local e janela (`Program.cs`, `AppWindow.cs`), importação e cortes booleanos (`ImportHost.cs`, `ModelCut.cs`, `CollisionCut.cs`), exportador (`Exporter.cs`, `FitExport.cs`) e leitor de arquivos vanilla (`Vanilla.cs`). |
| `ui\` | Interface do editor (WebGL e manipulação 3D). |
| `models\` | Modelos 3D de portas e janelas de exemplo incluídos no projeto. |
| `tools\` | Scripts auxiliares de build e verificação. |
| `docs\` | Documentação detalhada da arquitetura e funcionamento. |

## Créditos e Licenças

O MLO Creator utiliza a biblioteca do [CodeWalker](https://github.com/dexyfex/CodeWalker) para ler e escrever arquivos do GTA V, SharpDX e Microsoft WebView2. Consulte [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) e [models/CREDITS.txt](models/CREDITS.txt).

GTA V e todos os seus assets pertencem à Rockstar Games / Take-Two Interactive. Este projeto não possui vínculo com a Rockstar Games ou com a equipe do FiveM/Cfx.re.

O código-fonte do MLO Creator é disponibilizado sob a **Licença MIT** ([LICENSE](LICENSE)).

# Módulo 2 — auditoria estrutural e visual das pistas (`2026.7`)

## Estado

Implementação automatizada concluída; validação manual pendente. Esta revisão não marca a Parte 2d nem o Módulo 2 como prontos.

## Evidência analisada

Foram revisadas 497 capturas distribuídas pelas 24 pistas. Os defeitos recorrentes não eram 497 desenhos independentes: provinham de regras comuns do gerador e do renderer. Os exemplos apontados em Albert Park (zebras interrompidas ou deformadas e cortes bruscos), Mônaco e Shanghai (braços do circuito cobrindo um ao outro), Suzuka (passagem elevada sem estrutura inferior) e Monza (ausência de obstáculos na área de escape) foram tratados nessas regras comuns e em perfis específicos quando necessário.

## Correções implementadas

- Zebras são desenhadas e classificadas fisicamente fora da borda do asfalto; intervalos próximos do mesmo lado e paleta são unidos em uma faixa contínua.
- Barreiras são suavizadas e publicadas como uma única face canônica usada pelo desenho e pela colisão. A largura ao redor de braços vizinhos na mesma elevação é limitada para evitar invasão visual e colisões invisíveis.
- Grades seguem a face canônica e ganham face lateral, trilhos e postes projetados em 2.5D, em vez de uma linha plana.
- Todas as 24 pistas recebem pit lane visual contínuo, marcações de boxes e garagens extrudadas. A função de pit continua reservada ao Módulo 5.
- A origem de Mônaco foi deslocada para a reta de largada; grid, checkpoints, chunks e pit foram regenerados na mesma referência.
- Suzuka desenha tabuleiro inferior e apoios na passagem elevada.
- Monza recebe cinco obstáculos vermelhos e brancos na área de escape da primeira chicane.
- Objetos provisórios dispersos, como árvores e barcos isolados, foram removidos. O fundo base de cada pista foi preservado; cenário temático detalhado continua para uma rodada futura.
- O atlas de auditoria passou a usar diretamente o catálogo v2, exibindo pista, zebras externas, faces canônicas, pit e largada.

## Garantias automatizadas

- geração determinística das 24 definições;
- schema de pista `2.0.0`, catálogo `2026.7` e física `2.0.0` coerentes;
- espelho comum de `contracts/module-2/v2` idêntico byte a byte nos dois repositórios;
- pits com geometria suficiente para desenho contínuo em todas as pistas;
- nenhuma decoração provisória; somente infraestrutura permitida;
- largada em trecho reto, com posição específica de Mônaco auditada;
- cinco obstáculos de escape em Monza;
- continuidade das faces de barreira e separação entre braços próximos;
- testes do renderer para zebras externas, grade 2.5D, pits e ponte de Suzuka.

## Validação manual necessária

No preview integrado, percorrer as 24 pistas e conferir:

1. zebras sempre do lado externo da faixa de asfalto, contínuas em curvas longas e sem quinas artificiais;
2. faces de barreira e grade contínuas, sem cortes, saltos de largura ou fechamento atravessando a pista;
3. nenhuma cobertura indevida entre braços em Mônaco e Shanghai;
4. passagem elevada e estrutura inferior legíveis em Suzuka, sem colisão com o trecho inferior;
5. largada, grid e sentido de prova coerentes, com atenção especial a Mônaco;
6. pit lane, boxes e garagens visíveis e fora da linha de corrida nas 24 pistas;
7. obstáculos da primeira chicane de Monza visíveis e sem criar colisões invisíveis fora de sua geometria;
8. ausência dos barcos, árvores e outros landmarks provisórios removidos;
9. corrida solo, split-screen e bots sem regressão de física, colisão, culling ou desempenho.

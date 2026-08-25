# Contratos compartilhados do Módulo 2

## Objetivo

Fechar e versionar os formatos que atravessam frontend e backend: catálogo de pistas, coordenadas métricas, versão de física, geometria de colisão e decisões do modo local. Contratos publicados são históricos imutáveis; revisões incompatíveis entram em uma nova linha.

## Estado executável atual — contrato histórico 1.3.0

- Temporada de referência: calendário original de 24 etapas da Fórmula 1 de 2026, congelado para o catálogo `2026.5`.
- O catálogo não muda automaticamente quando o calendário real é alterado durante a temporada.
- Colisão entre carros existe no modo local.
- Split-screen usa divisão vertical em telas largas e horizontal abaixo da razão de aspecto `1.35`.
- Todos os participantes usam um único modelo F1; a pintura predefinida é a única escolha visual de veículo.
- Existe uma única configuração de condução, baseada exatamente nos valores do antigo perfil Normal e aplicada a todas as corridas.
- Dano local é mecânico, cumulativo e determinístico no Módulo 2: a intensidade classifica falhas de direção, motor, combinação das duas ou perda total, e toda colisão relevante reduz a vida.
- Dificuldade dos bots melhora ritmo, frenagem, trajetória, recuperação e consistência ao mesmo tempo.
- Física usa subpasso canônico de `1/60 s`. O servidor do Módulo 3 roda a `30 Hz`, executando dois subpassos por tick.

As issues frontend #90 e backend #72 publicaram esta revisão incompatível de forma sincronizada. `module-2-decisions.json`, `physics-constants.json`, seu schema e os cenários determinísticos usam `1.3.0`; `carModel`, `handlingMode`, `driftMode`, Supercarro e Drift não fazem parte do contrato. Recordes e fantasmas não segmentam resultados por modelo ou modo, e a progressão futura libera apenas pinturas, capacetes e acabamentos do F1.

O `v1.3.0` também contém uma reserva histórica de nitro/Shift que nunca ganhou efeito no Módulo 2. Essa decisão foi revogada para o sucessor, mas os arquivos dentro de `contracts/module-2/v1/` não serão reescritos silenciosamente.

## Sucessor aprovado — Parte 2d e contrato 2.0.0

A Parte 2d substitui o integrador arcade por uma simulação acessível de F1 e remove boost/nitro integralmente antes do Módulo 3. A especificação normativa pré-implementação está em [`module-2-physics-v2-proposal.md`](module-2-physics-v2-proposal.md).

Decisões fechadas:

- corpo rígido 2D com modelo de bicicleta dinâmico, pneus não lineares e aderência combinada;
- velocidade longitudinal/lateral, yaw, esterço físico, transferência de carga, drag e downforce;
- tração traseira, oito marchas automáticas, sem controle de tração e sem ABS;
- input somente por `throttle`, `brake` e `steer`, com rampas digitais determinísticas; `Shift` sem função;
- veículo com colliders convexos compostos alinhados à silhueta, no lugar do raio circular;
- barreiras com face canônica explícita usada igualmente por renderer, TypeScript e Java;
- CCD, manifold, impulsos no ponto de contato, torque e solver iterativo determinístico;
- dano cumulativo classificado por impulso/energia ou `delta-v`, não apenas pela velocidade absoluta;
- `physicsContractVersion` persistida em salas, resultados, recordes e fantasmas;
- nova linha `contracts/module-2/v2/`, schema de pista `2.0.0` e catálogo `2026.6`; o catálogo `2026.5` permanece válido somente para o runtime v1.

O diretório v2 só se torna executável quando constantes fundamentadas, schemas, geometrias, motor TypeScript e cenários passarem juntos. Não publicar valores desconhecidos como `null` ou tuning arbitrário.

## Catálogo e pista

`GET /api/tracks` segue `track-catalog.schema.json`. `GET /api/tracks/{id}` segue `track-definition.schema.json`.

Cada definição contém:

- centro da pista fechado e amostrado em metros;
- meia largura dirigível por ponto;
- ambiente lateral por trecho e por lado, com zero ou mais zonas ordenadas de asfalto, grama ou brita, a barreira física de impacto ao fim delas e uma grade externa opcional;
- linha inicial dos bots;
- largada/chegada, quatro posições de grid e oito checkpoints direcionais;
- pit lane simplificado e já reservado no contrato, embora sua mecânica completa pertença ao Módulo 5;
- chunks com caixas delimitadoras para culling;
- preset e âncoras mínimas de cenário;
- atribuição, descrição da transformação e referências ambientais consultadas por circuito.

O ponto está dentro da pista quando sua menor distância ao centro é menor ou igual à meia largura interpolada. Cada ponto da centerline publica `halfWidthMeters` e `elevationLayer`: a largura pode variar com transições suaves, e a camada impede que a ponte e a passagem inferior de Suzuka misturem projeção, desenho ou colisões. O schema de pista `1.3.0` suaviza a fonte fechada, arredonda os vértices e reamostra a volta a cada aproximadamente 5 m; asfalto, entornos, barreiras, grades, física, câmera e minimapa derivam dessa mesma geometria. `trackLimits.segments` cobre a volta continuamente; cada lado possui `zones[]`, da borda da pista para fora, uma barreira de impacto entre `concrete-wall`, `guardrail`, `tecpro` e `tyre-barrier` e, quando aplicável, `fence: "debris-fence"` como camada externa adicional. A colisão v1 acontece na barreira implícita, depois da soma das larguras das zonas daquele lado; a grade não desloca o limite físico. Uma lista vazia representa barreira praticamente junto ao asfalto. `curbs[]` descreve cada zebra por intervalo métrico, lado, largura, comprimento de faixa e paleta; a geração usa a curvatura da centerline e a contagem oficial de curvas, com perfil de cores por circuito. No contrato `1.3.0`, brita ainda reutiliza a tração de grama. O v2 passa a tratá-la como superfície própria e publica a face tocável de cada barreira para que desenho e colisão sejam idênticos.

### Auditoria ambiental, geométrica e de cenário do catálogo 2026.5

Os antigos perfis genéricos `walled`, `mixed` e `open`, assim como a faixa global de 10 m, foram removidos. O backend registra um perfil exclusivo para cada uma das 24 pistas em `tools/track-catalog/track-environments.mjs`, com intervalos normalizados por lado, larguras conservadoras e pelo menos duas referências. A pesquisa prioriza mapas e notas de prova da FIA de 2025/2026, páginas oficiais dos autódromos e material oficial da Fórmula 1; imagens aéreas e onboards oficiais só complementam o que os documentos não detalham. A segunda passagem ambiental confrontou os 24 perfis, corrigiu lados e materiais documentados e separou grades externas das barreiras de impacto. A revisão geométrica `2026.4` acrescentou suavização fechada, limite automatizado de lacuna/variação angular, perfis de zebra em `tools/track-catalog/track-curbs.mjs` e o atlas reproduzível `tools/track-catalog/render-atlas.mjs`. O catálogo `2026.5` mantém esses dados e acrescenta `tools/track-catalog/track-scenery.mjs`: quatro ou mais objetos explícitos por circuito, com `kind` semântico e transformação resolvida a partir de uma âncora na centerline. As referências usadas em cada pista também são publicadas em `source.environmentReferences` dentro de sua definição.

Grades só viram regra bilateral de toda a volta quando a metragem do fornecedor sustenta essa cobertura, como em Miami e Las Vegas. Jeddah, Baku e Lusail mantêm apenas os setores que as fontes permitem mapear com segurança; ausência de grade em outro trecho do modelo significa evidência insuficiente, não uma afirmação topográfica de que ela inexiste no circuito real.

O utilitário `tools/track-catalog/audit-turns.mjs` do backend calcula apenas âncoras heurísticas sobre a centerline para ajudar a localizar trechos. Numeração, sentido das curvas e lado externo sempre precisam ser confirmados nas referências oficiais; o gerador rejeita intervalos sobrepostos para evitar perfis dependentes da ordem das regras.

As larguras são discretizadas e orientadas à leitura/jogabilidade; não são um levantamento topográfico centimétrico. O gerador usa uma meia largura representativa por pista e somente introduz variação local quando existe fonte confiável, incluindo os 7,6 m totais da passagem do castelo em Baku. Elas distinguem as relações relevantes: muro junto à pista em circuitos urbanos, asfalto antes de brita, grama até guardrail, grandes escapes pavimentados e proteções absorventes nas zonas de impacto. Madrid permanece provisória porque ainda não existe um pacote público de mapa e Competition Notes da FIA detalhando todas as superfícies e proteções do primeiro evento: o perfil usa as áreas asfaltadas e muros presentes no GIS oficial e não inventa grama ou brita. Qualquer revisão posterior exige nova `catalogVersion`, nova fonte e sincronização dos dois repositórios.

A linha de corrida v1 começa no centro e poderá ser calibrada sem alterar o schema, desde que a `catalogVersion` seja incrementada quando a geometria publicada mudar.

## Calendário congelado

1. Austrália — Albert Park
2. China — Shanghai
3. Japão — Suzuka
4. Bahrain — Sakhir
5. Arábia Saudita — Jeddah
6. Estados Unidos — Miami
7. Canadá — Montreal
8. Mônaco — Monaco
9. Espanha — Barcelona-Catalunya
10. Áustria — Spielberg
11. Reino Unido — Silverstone
12. Bélgica — Spa-Francorchamps
13. Hungria — Hungaroring
14. Países Baixos — Zandvoort
15. Itália — Monza
16. Espanha — Madrid
17. Azerbaijão — Baku
18. Singapura — Marina Bay
19. Estados Unidos — Austin
20. México — Mexico City
21. Brasil — Interlagos
22. Estados Unidos — Las Vegas
23. Qatar — Lusail
24. Emirados Árabes Unidos — Yas Marina

Fontes de calendário: anúncio oficial conjunto FIA/Fórmula 1 e calendário oficial da Fórmula 1 para 2026. O jogo mantém a lista original de 24 etapas por decisão de produto, independentemente de alterações posteriores do campeonato real.

## Física

`contracts/module-2/v1/physics-constants.json` é a folha inicial atualmente consumida. Os valores estão marcados como `initial`: são uma calibração arcade histórica em unidades SI, não promessa de reprodução de um simulador real.

O frontend M2 deve:

1. implementar o integrador canônico usando exclusivamente essa folha;
2. executar os cenários de referência;
3. registrar os estados finais esperados e trocar `calibrationStatus` para `validated` após validação manual.

O backend M3 deve reproduzir os mesmos cenários dentro das tolerâncias declaradas. Divergência é bug.

O contrato físico `1.3.0` define um único F1, uma única condução e fixa limiares de impacto, vida e efeitos moderados de dano. Impacto fraco danifica direção, médio danifica motor, alto combina ambos e crítico causa perda total; a vida cumulativa também permite que colisões menores repetidas terminem a corrida. Motor danificado reduz moderadamente aceleração e velocidade máxima, direção danificada aplica um leve desvio persistente para um lado sem retirar autoridade de esterço, e perda total ignora inputs e aumenta o arrasto até a parada. O frontend aplica essas regras na corrida local; o backend deve consumir os mesmos valores ao implementar a simulação autoritativa.

O contrato `2.0.0` não reaproveita aceleração/frenagem constantes, hard cap de velocidade, correção linear de aderência, `targetYawRate` nem `collisionRadiusMeters`. Ele deve publicar equações, ordem de integração, propriedades de massa/geometria, controles, powertrain, freios, pneus, aerodinâmica, superfícies, solver e tolerâncias. Cenários cobrem aceleração, coast-down, frenagem/travamento, curva constante, subesterço/sobresterço, power-oversteer, transições de superfície, impactos excêntricos, folga em muros e CCD. O TypeScript congela os estados esperados depois da calibração; o Java os reproduz dentro das tolerâncias.

## Resultado local e segurança

O backend obtém o usuário do JWT e nunca aceita um `userId` arbitrário como identidade. Guest e bot não criam resultado associado a uma conta. O Módulo 2 persiste dados consultáveis; a API pública de histórico continua pertencendo ao Módulo 8. Ao ativar a Parte 2d, cada resultado passa a carregar `physicsContractVersion`, impedindo comparação direta entre tempos de motores incompatíveis.

## Fluxo Git

Mudanças compartilhadas devem chegar aos dois repositórios na mesma rodada. Para promoções `develop → main`, usar merge commit quando houver histórico compartilhado; squash exige sincronizar `main` de volta em `develop` antes do próximo módulo e foi a causa das divergências históricas observadas.

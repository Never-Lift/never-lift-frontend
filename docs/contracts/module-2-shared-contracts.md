# Contratos compartilhados do Módulo 2

## Objetivo

Fechar antes da implementação os formatos que atravessam frontend e backend: catálogo de pistas, coordenadas métricas, versão de física e decisões do modo local. Esta rodada não implementa endpoints nem o `RaceEngine`.

## Decisões fechadas

- Temporada de referência: calendário original de 24 etapas da Fórmula 1 de 2026, congelado para o catálogo `2026.1`.
- O catálogo não muda automaticamente quando o calendário real é alterado durante a temporada.
- Colisão entre carros existe no modo local.
- Split-screen usa divisão vertical em telas largas e horizontal abaixo da razão de aspecto `1.35`.
- Dano local é somente cosmético no Módulo 2; não altera física, velocidade nem resultado.
- Dificuldade dos bots melhora ritmo, frenagem, trajetória, recuperação e consistência ao mesmo tempo.
- Física usa subpasso canônico de `1/60 s`. O servidor do Módulo 3 roda a `30 Hz`, executando dois subpassos por tick.

## Catálogo e pista

`GET /api/tracks` segue `track-catalog.schema.json`. `GET /api/tracks/{id}` segue `track-definition.schema.json`.

Cada definição contém:

- centro da pista fechado e amostrado em metros;
- meia largura dirigível por ponto;
- linha inicial dos bots;
- largada/chegada, quatro posições de grid e oito checkpoints direcionais;
- pit lane simplificado e já reservado no contrato, embora sua mecânica completa pertença ao Módulo 5;
- chunks com caixas delimitadoras para culling;
- preset e âncoras mínimas de cenário;
- atribuição e descrição da transformação dos dados de origem.

O ponto está dentro da pista quando sua menor distância ao centro é menor ou igual à meia largura interpolada. Fora desse limite, a superfície padrão é grama. A linha de corrida v1 começa no centro e poderá ser calibrada sem alterar o schema, desde que a `catalogVersion` seja incrementada quando a geometria publicada mudar.

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

`physics-constants.json` é a folha inicial compartilhada. Os valores estão marcados como `initial`: são uma calibração coerente em unidades SI, não promessa de reprodução de um simulador real.

O frontend M2 deve:

1. implementar o integrador canônico usando exclusivamente essa folha;
2. executar os cenários de referência;
3. registrar os estados finais esperados e trocar `calibrationStatus` para `validated` após validação manual.

O backend M3 deve reproduzir os mesmos cenários dentro das tolerâncias declaradas. Divergência é bug.

## Resultado local e segurança

O backend obtém o usuário do JWT e nunca aceita um `userId` arbitrário como identidade. Guest e bot não criam resultado associado a uma conta. O Módulo 2 persiste dados consultáveis; a API pública de histórico continua pertencendo ao Módulo 8.

## Fluxo Git

Mudanças compartilhadas devem chegar aos dois repositórios na mesma rodada. Para promoções `develop → main`, usar merge commit quando houver histórico compartilhado; squash exige sincronizar `main` de volta em `develop` antes do próximo módulo e foi a causa das divergências históricas observadas.

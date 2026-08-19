# Contratos compartilhados do Módulo 2 — v1

Esta pasta contém os artefatos que precisam permanecer compatíveis entre o frontend TypeScript e o backend Java.

## Arquivos

- `module-2-decisions.json`: decisões de escopo fechadas antes da implementação.
- `track-catalog.schema.json`: contrato do catálogo retornado por `GET /api/tracks`.
- `track-definition.schema.json`: contrato da definição métrica retornada por `GET /api/tracks/{id}`.
- `catalog.json`: manifesto congelado dos 24 circuitos da temporada de referência de 2026.
- `physics-constants.schema.json`: formato da folha de constantes físicas.
- `physics-constants.json`: calibração compartilhada v1.2 do perfil mecânico único, silhuetas, superfícies, colisão, dano e bots.
- `physics-reference-scenarios.json`: cenários determinísticos que o motor TypeScript deve fechar no Módulo 2 e o motor Java deve reproduzir no Módulo 3.

## Fonte canônica

Os schemas, decisões, manifesto e constantes desta pasta devem ser idênticos nos dois repositórios. As 24 definições completas das pistas e o gerador ficam somente no backend, que é a fonte do catálogo em execução. O frontend nunca embute uma segunda cópia das geometrias em produção: consome a API, valida `catalogVersion` e mantém a definição selecionada em memória.

Mudanças incompatíveis exigem nova versão de contrato e de catálogo. Nunca alterar silenciosamente um arquivo publicado sob a versão `v1`.

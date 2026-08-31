# Módulo 2 — segunda auditoria visual das 24 pistas (`2026.8`)

## Estado

Implementação automatizada concluída; validação manual integrada pendente. Esta revisão não marca a Parte 2d nem o Módulo 2 como prontos.

## Objetivo e evidência

A revisão partiu das 497 capturas da auditoria anterior, de uma nova inspeção do atlas completo e dos mapas oficiais registrados em `source.environmentReferences` de cada `TrackDefinition`. Em vez de redesenhar cada captura isoladamente, foram corrigidas as causas compartilhadas no gerador e no renderer, mantendo exceções explícitas quando a pista real exige.

## O que mudou em todas as pistas

- Zebras continuam totalmente fora da faixa de asfalto. Interrupções curtas agora só são fechadas quando a curvatura permanece na mesma direção; chicanes e mudanças de direção não são unidas indevidamente.
- Faces canônicas de barreira preservam a mesma geometria visual e física. O renderer deixou de desenhar uma tampa transversal em cada amostra e arredonda as uniões superiores, eliminando cortes escuros e quinas artificiais.
- Cercas de proteção recebem tela, postes e travessas com altura 2.5D. Circuitos de rua ficam protegidos em toda a volta; circuitos permanentes recebem cercas nas áreas com arquibancadas, sem inventar telas em zonas sem público.
- Cada circuito possui um perfil de box próprio: arquitetura, paleta, altura e quantidade de vãos. Garagens têm marcação de box, portas segmentadas, placas, faixas, vidros, cobertura e detalhes específicos de arquitetura.
- Cada pista possui ao menos quatro zonas de arquibancada representativas e uma construção principal ou torre. Assentos, corredores, cobertura, suportes, iluminação, fachadas e janelas são desenhados vetorialmente e descartados quando fora da câmera.
- Cenários provisórios dispersos continuam removidos. O catálogo adiciona somente infraestrutura reconhecível da pista; paisagismo temático completo permanece fora desta revisão.

## Perfis auditados por circuito

| Circuito | Identidade do box | Arquibancadas e construção de referência |
|---|---|---|
| Albert Park | modular temporário, cinza e azul | Main, Jones, Fangio, Prost e race control |
| Shanghai | complexo permanente vermelho/cinza | Main, Lotus, T1, hairpin e paddock pavilion |
| Suzuka | complexo permanente vermelho/branco | V, T1, S Curves, Spoon e race control |
| Bahrain | fachadas claras e coberturas desérticas | Main, T1, University, Victory e Sakhir tower |
| Jeddah | edifício moderno escalonado | Main, Central, T1, T27 e team building |
| Miami | módulos claros no entorno do estádio | Main, T1, Marina, Beach e Hard Rock Stadium |
| Montréal | edifício permanente azul/cinza | Platine, Senna, Hairpin, Wall of Champions e paddock |
| Monaco | boxes urbanos compactos | K, Piscine, Casino, Harbour e pit control |
| Barcelona | complexo permanente moderno | Main, T1, Stadium, final corner e pit building |
| Spielberg | complexo permanente alpino | Main, T1, North, Southwest e race control |
| Silverstone | linguagem do Wing | International Pits, Abbey, Becketts, Stowe e Silverstone Wing |
| Spa-Francorchamps | boxes de linguagem histórica | Main, Raidillon, Eau Rouge, Les Combes e pit building |
| Hungaroring | complexo permanente renovado | Main, T1, final sector e race control |
| Zandvoort | linguagem histórica e laranja discreto | Main, Tarzan, Arena, Eastside e pit building |
| Monza | edifícios históricos em tons neutros | Main, Rettifilo, Ascari, Parabolica e pit tower |
| Madrid | complexo ligado ao IFEMA | Main, T1, banked corner, IFEMA pavilion e race control |
| Baku | boxes urbanos compactos | Main, T1, Sahil, Old City e pit building |
| Singapore | complexo urbano noturno | Super Pit, T1, Padang, Connaught e pit building |
| Austin | complexo permanente | Main, T1, T12, T15 e race control |
| México | linguagem do estádio | Main, Foro Sol, T1, Esses e pit building |
| Interlagos | complexo histórico compacto | Main, Senna S, setores A/M e pit complex |
| Las Vegas | edifício permanente em tons escuros/dourados | Main, Sphere, East Harmon, Koval e pit building |
| Lusail | complexo claro com cobertura | Main, North, T2, final corner e pit building |
| Yas Marina | complexo claro com cobertura de marina | Main, North, West, Marina e pit building |

Os nomes identificam setores e geografia; não reproduzem marcas de patrocinadores. As ilustrações são originais do Never Lift e mantêm a escala estilizada definida no game design guide.

## Cruzamento de Suzuka

O catálogo preserva dois níveis físicos independentes e a auditoria exige ao menos uma interseção geométrica real entre o trecho inferior e o superior. Para cada viewport, quando o carro focal está no nível inferior e entra em um raio de 62 m do cruzamento, a camada superior reduz a opacidade suavemente até `0.34` a 18 m. O efeito inclui pista, barreiras, cercas, marcas de pneu, estrutura e carros do nível superior; à noite, inclui também os fachos desses carros. O carro inferior e seu próprio nível permanecem sólidos. Ao se afastar, a camada superior volta suavemente à opacidade total.

## Garantias automatizadas

- geração determinística e schemas coerentes para as 24 definições `2026.8`;
- pelo menos cinco estruturas de pista e três zonas de arquibancada por circuito;
- paletas hexadecimais, de 8 a 16 garagens e altura plausível do edifício de boxes;
- cercas de segurança presentes em todas as pistas e integrais nos circuitos de rua;
- zebras sem sobreposição por lado e sem união através de mudança de direção;
- nenhuma tampa interna repetida nas amostras de barreira;
- cruzamento inferior/superior de Suzuka preservado;
- espelho dos artefatos comuns de `contracts/module-2/v2` byte a byte idêntico entre frontend e backend.

## Validação manual necessária

Percorrer as 24 pistas no preview integrado e confirmar:

1. zebras externas, contínuas em curvas longas e separadas em mudanças reais de direção;
2. barreiras e cercas sem cortes, tampas internas, saltos de largura ou sobreposição com outro braço;
3. boxes fora da linha de corrida, legíveis e coerentes com a identidade de cada autódromo;
4. arquibancadas e construções nas regiões esperadas, sem cobrir pista, pit ou área de escape;
5. desempenho/culling com a densidade adicional de estruturas, em solo e split-screen;
6. Suzuka: aproximação inferior, transparência progressiva, carros superiores translúcidos e retorno suave ao sólido;
7. Suzuka: carro no nível superior não ativa transparência;
8. corrida, bots, colisão e checkpoint sem regressão, pois a física canônica não foi alterada.

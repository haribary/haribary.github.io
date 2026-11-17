# Judge benchmark (tag: bedrock)

Generated 2026-11-17T12:57:46.362Z. Prices from backend/src/judge.mjs PRICES (source URL there). Total spend so far: $1.6502 of $8.

| model | n | accuracy | false accepts | false rejects | p50 ms | p95 ms | max ms | errors | timeouts | in tok | out tok | $/1k | canonical ok | spearman |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| us.amazon.nova-micro-v1:0 | 213 | 57.3% | 15 | 75 | 451 | 560 | 859 | 1 | 0 | 427 | 30.7 | n/a | 32/32 | 0.63 |
| us.amazon.nova-2-lite-v1:0 | 213 | 77.5% | 18 | 30 | 592 | 736 | 1361 | 0 | 0 | 442 | 41.9 | n/a | 65/66 | 0.64 |
| us.amazon.nova-pro-v1:0 | 213 | 34.7% | 1 | 10 | 625 | 2506 | 2834 | 123 | 5 | 425 | 33.5 | n/a | 29/29 | 0.76 |

## Accuracy by kind

| model | held-out | unlisted | near-miss | junk |
|---|---|---|---|---|
| us.amazon.nova-micro-v1:0 | 32/84 | 1/24 | 68/84 | 21/21 |
| us.amazon.nova-2-lite-v1:0 | 66/84 | 12/24 | 66/84 | 21/21 |
| us.amazon.nova-pro-v1:0 | 29/84 | 0/24 | 38/84 | 7/21 |

## us.amazon.nova-micro-v1:0

False accepts: big-tech-founder:"Tim Cook"; big-tech-founder:"Satya Nadella"; big-tech-founder:"Sundar Pichai"; big-tech-founder:"Steve Ballmer"; big-tech-founder:"Eric Schmidt"; big-tech-founder:"Pat Gelsinger"; sorting-algo:"quickselect"; sorting-algo:"Fisher-Yates shuffle"; sorting-algo:"Kruskal's algorithm"; turing-award:"Alan Turing"; turing-award:"Claude Shannon"; turing-award:"John von Neumann"; turing-award:"Grace Hopper"; turing-award:"Brian Kernighan"; turing-award:"Jurgen Schmidhuber"

False rejects: ai-chatbot:"ChatGPT"; ai-chatbot:"copilot"; ai-chatbot:"Meta AI"; ai-chatbot:"le chat mistral"; ai-chatbot:"kimi"; ai-chatbot:"Mycroft"; ai-chatbot:"Hound"; ai-chatbot:"openassistant"; ai-chatbot:"Meena"; python-builtin:"print"; python-builtin:"list"; python-builtin:"property"; python-builtin:"object"; python-builtin:"slice"; python-builtin:"__import__"; paypal-mafia:"Elon Musk"; paypal-mafia:"steven chen"; paypal-mafia:"Jawed Karim"; paypal-mafia:"jeremy stoppelman"; paypal-mafia:"Botha"; paypal-mafia:"Yishan Wong"; paypal-mafia:"Dave McClure"; paypal-mafia:"premal shah"; paypal-mafia:"eric jackson"; paypal-mafia:"Jack Selby"; activation-fn:"heaviside"; activation-fn:"randomized leaky relu"; activation-fn:"continuously differentiable exponential linear unit"; activation-fn:"ReGLU"; activation-fn:"tanhshrink"; activation-fn:"alpha entmax"; activation-fn:"inverse square root unit"; big-tech-founder:"Steve Jobs"; big-tech-founder:"Son"; big-tech-founder:"Chris Hughes"; big-tech-founder:"JB Straubel"; big-tech-founder:"chris olah"; big-tech-founder:"Michelle Zatlyn"; big-tech-founder:"Dietmar Hopp"; big-tech-founder:"Charles Ranlett Flint"; big-tech-founder:"weili dai"; big-tech-founder:"Henry Taub"; big-tech-founder:"Joe Parkinson"; sorting-algo:"Sleep sort"; sorting-algo:"Tree sort"; sorting-algo:"pattern defeating quicksort"; sorting-algo:"Strand sort"; sorting-algo:"Quantum bogosort"; sorting-algo:"miracle sort"; sorting-algo:"Spreadsort"; sorting-algo:"Fluxsort"; turing-award:"ronald rivest"; ai-chatbot:"Erica"; ai-chatbot:"Amazon Q"; ai-chatbot:"Duck.ai"; ai-chatbot:"Lumo"; ai-chatbot:"Coral"; ai-chatbot:"Jasper Chat"; activation-fn:"Bent identity"; activation-fn:"ISRLU"; activation-fn:"SQNL"; activation-fn:"TanhExp"; activation-fn:"Serf"; sorting-algo:"Cartesian tree sort"; sorting-algo:"Weak heap sort"; sorting-algo:"Bogobogosort"; sorting-algo:"Splaysort"; sorting-algo:"Interpolation sort"; sorting-algo:"Postman sort"; big-tech-founder:"Ed Turney"; big-tech-founder:"John Carey"; big-tech-founder:"Jack Gifford"; big-tech-founder:"Harvey White"; big-tech-founder:"Klein Gilhousen"; big-tech-founder:"Zeng Yuqun"

## us.amazon.nova-2-lite-v1:0

False accepts: python-builtin:"join"; paypal-mafia:"Travis Kalanick"; paypal-mafia:"Evan Williams"; paypal-mafia:"Aaron Levie"; big-tech-founder:"Tim Cook"; big-tech-founder:"Satya Nadella"; big-tech-founder:"Lisa Su"; big-tech-founder:"Andy Grove"; big-tech-founder:"Sundar Pichai"; big-tech-founder:"Hock Tan"; big-tech-founder:"Andy Jassy"; big-tech-founder:"Steve Ballmer"; big-tech-founder:"Eric Schmidt"; big-tech-founder:"Jeff Dean"; big-tech-founder:"Pat Gelsinger"; turing-award:"Claude Shannon"; turing-award:"Ian Goodfellow"; turing-award:"Jurgen Schmidhuber"

False rejects: ai-chatbot:"le chat mistral"; ai-chatbot:"Hound"; python-builtin:"list"; python-builtin:"property"; python-builtin:"object"; paypal-mafia:"Elon Musk"; paypal-mafia:"steven chen"; paypal-mafia:"Jawed Karim"; paypal-mafia:"Botha"; paypal-mafia:"eric jackson"; activation-fn:"randomized leaky relu"; activation-fn:"tanhshrink"; big-tech-founder:"Son"; big-tech-founder:"Charles Ranlett Flint"; big-tech-founder:"Joe Parkinson"; sorting-algo:"Fluxsort"; turing-award:"Maurice Wilkes"; turing-award:"Jim Gray"; ai-chatbot:"Duck.ai"; ai-chatbot:"Coral"; ai-chatbot:"Jasper Chat"; activation-fn:"ISRLU"; activation-fn:"TanhExp"; activation-fn:"Serf"; sorting-algo:"Weak heap sort"; sorting-algo:"Postman sort"; big-tech-founder:"Ed Turney"; big-tech-founder:"John Carey"; big-tech-founder:"Jack Gifford"; big-tech-founder:"Harvey White"

## us.amazon.nova-pro-v1:0

False accepts: big-tech-founder:"Lisa Su"

False rejects: ai-chatbot:"le chat mistral"; python-builtin:"list"; python-builtin:"property"; python-builtin:"slice"; paypal-mafia:"steven chen"; paypal-mafia:"Jawed Karim"; big-tech-founder:"Son"; big-tech-founder:"JB Straubel"; big-tech-founder:"chris olah"; activation-fn:"TanhExp"

## Wrong for every model

- ai-chatbot: "le chat mistral" (expected valid, held-out)
- python-builtin: "list" (expected valid, held-out)
- python-builtin: "property" (expected valid, held-out)
- paypal-mafia: "steven chen" (expected valid, held-out)
- paypal-mafia: "Jawed Karim" (expected valid, held-out)
- paypal-mafia: "Botha" (expected valid, held-out)
- paypal-mafia: "eric jackson" (expected valid, held-out)
- big-tech-founder: "Son" (expected valid, held-out)
- big-tech-founder: "Charles Ranlett Flint" (expected valid, held-out)
- big-tech-founder: "Joe Parkinson" (expected valid, held-out)
- big-tech-founder: "Satya Nadella" (expected invalid, near-miss)
- big-tech-founder: "Andy Jassy" (expected invalid, near-miss)
- big-tech-founder: "Steve Ballmer" (expected invalid, near-miss)
- big-tech-founder: "Eric Schmidt" (expected invalid, near-miss)
- big-tech-founder: "Pat Gelsinger" (expected invalid, near-miss)
- sorting-algo: "Fluxsort" (expected valid, held-out)
- turing-award: "Claude Shannon" (expected invalid, near-miss)
- turing-award: "Jurgen Schmidhuber" (expected invalid, near-miss)
- ai-chatbot: "Duck.ai" (expected valid, unlisted)
- ai-chatbot: "Coral" (expected valid, unlisted)
- ai-chatbot: "Jasper Chat" (expected valid, unlisted)
- activation-fn: "ISRLU" (expected valid, unlisted)
- activation-fn: "TanhExp" (expected valid, unlisted)
- activation-fn: "Serf" (expected valid, unlisted)
- sorting-algo: "Weak heap sort" (expected valid, unlisted)
- sorting-algo: "Postman sort" (expected valid, unlisted)
- big-tech-founder: "Ed Turney" (expected valid, unlisted)
- big-tech-founder: "John Carey" (expected valid, unlisted)
- big-tech-founder: "Jack Gifford" (expected valid, unlisted)
- big-tech-founder: "Harvey White" (expected valid, unlisted)

# Dispečr

AI dispečer pro řemeslníky a menší servisní firmy. Zákazník přijde na web,
popíše závadu, agent zjistí chybějící údaje, vyhodnotí naléhavost a nabídne
konkrétní volný termín. Řemeslník dostane hotovou zakázku k jednomu kliknutí.

MVP příležitosti č. 3 z analýzy `AI_prilezitosti_2026`.

## Spuštění

```bash
npm install
npm run seed      # založí demo firmu tp_demo
npm run dev       # http://localhost:3000
npm test          # 42 testů, bez síťových závislostí
```

- `/` — příjem poptávek (pohled zákazníka), veřejné
- `/dispatch?token=…` — dispečink (pohled řemeslníka), chráněné

`ANTHROPIC_API_KEY` je **nepovinný**. Bez něj běží deterministický fallback,
takže příjem poptávek funguje i při výpadku modelu — viz `src/lib/triage.ts`.

## Přístup k dispečinku

Dispečink ukazuje jména, telefony a adresy zákazníků a umožňuje zakázky
potvrzovat a rušit. Chrání ho sdílený token v `DISPECR_DISPATCH_TOKEN`;
řemeslník si otevře `/dispatch?token=…` a URL si uloží do záložek.

Bez nastaveného tokenu je dispečink otevřený jen ve vývoji — **v produkci se
odmítne obsloužit**. Fail-closed je tu schválně: chybějící konfigurace nesmí
tiše vystavit data zákazníků.

Je to záměrně minimum, ne účtový systém: token není per-uživatel a odvolat ho
jde jen rotací hodnoty. Až bude potřeba víc, je to místo, kam přijde skutečná
autentizace.

## Návrhový princip: agent píše, kód rozhoduje

Model dělá jen dvě věci: **vytáhne údaje** z volného textu a **naformuluje
jednu otázku**. Nic víc.

Všechno ostatní je deterministický kód v `src/lib/conversation.ts`:

- kdy je sběr údajů hotový (`missingFields`),
- které termíny jsou volné (`src/lib/slots.ts` — proti kalendáři, ne z hlavy),
- co se zapíše do kalendáře (`src/lib/bookings.ts`).

Důvod je provozní, ne estetický: model, který si vymyslí termín, stojí
řemeslníka reálný výjezd. Agent proto nikdy termín nepotvrzuje — jen ho
**drží**.

## Životní cyklus zakázky

```
collecting ──▶ proposing ──▶ held ──▶ confirmed
                                └──▶ rejected / expired
```

`held` je jádro celého návrhu. Rezervace vzniká jako *hold* s expirací
(výchozí 30 minut). Řemeslník ji musí aktivně potvrdit; když nestihne,
slot se sám uvolní. Držené i potvrzené termíny blokují kalendář stejně,
takže se dva zákazníci nemůžou sejít na jednom výjezdu.

Kontrola volnosti slotu i zápis běží v jedné SQLite transakci
(`reserveSlot`) — mezi nabídkou a odpovědí zákazníka může slot obsadit
někdo jiný, a v tom případě agent nabídne nové termíny místo potvrzení
něčeho, co už nemůže splnit.

## Testy

`npm test` (Node test runner, žádná další závislost). Pokrývají to, co může
stát řemeslníka výjezd:

- generování termínů — lead time, pracovní doba, zavírací hodina, víkend
- kolize — držený i potvrzený termín blokují kalendář, částečný překryv
- expirace holdu — uvolní slot, ale nejde ji potvrdit po termínu
- stavový automat — nikdy nepřeskočí chybějící údaj, nikdy nerezervuje při
  nejasné odpovědi, nikdy netvrdí „držíme termín", když žádný nevznikl
- parsování volby termínu — `14:30` v textu není volba č. 1
- autorizace dispečinku včetně fail-closed chování v produkci

Čas se **injektuje** (`now` parametr) do celé vrstvy — rezervací i konverzace.
Bez toho byly testy závislé na denní době: odpoledne se do zavíračky vejde
jen jeden termín, takže test „vyber možnost 2" po 13:00 padal.

## Naléhavost řídí, jak daleko se hledá

| Naléhavost | Nejdřív za | Nabízí max. do |
| ---------- | ---------- | -------------- |
| Havárie    | 45 min     | 12 h           |
| Naléhavé   | 2 h        | 48 h           |
| Běžné      | 24 h       | 14 dní         |

Havárie, na kterou je nejbližší termín za čtyři dny, není termín, na který
zákazník počká — proto se okno raději omezí a zakázka spadne na telefon.

## API

| Endpoint | Popis |
| -------- | ----- |
| `POST /api/chat` | `{ tradespersonId?, conversationId?, text }` → `{ conversationId, reply, state }` |
| `GET /api/chat?conversationId=` | přepis konverzace |
| `GET /api/bookings?tradespersonId=` | zakázky, držené první |
| `POST /api/bookings/:id` | `{ action: "confirm" \| "reject", reason? }` |

## Co v MVP záměrně není

- **Platby / zálohy.** Zálohy zvyšují tření při konverzi a řada řemeslníků je
  nechce. Než se zavedou, patří ověřit u zákazníků; napojení je pak na
  GoPay/Comgate nebo QR platbu, ne na Stripe.
- **Skutečné SMS / WhatsApp.** `src/lib/notify.ts` jen loguje — celý tok jde
  odzkoušet bez externích účtů.
- **Hlasový agent.** Nejtěžší část, patří do verze 2.
- **Časová pásma.** Pracovní doba se počítá v lokálním čase serveru. Pro ČR to
  stačí, pro cokoli dalšího je to první věc k opravě.

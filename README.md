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
```

- `/` — příjem poptávek (pohled zákazníka)
- `/dispatch` — dispečink (pohled řemeslníka)

`ANTHROPIC_API_KEY` je **nepovinný**. Bez něj běží deterministický fallback,
takže příjem poptávek funguje i při výpadku modelu — viz `src/lib/triage.ts`.

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
- **Autentizace dispečinku.** `/dispatch` je zatím otevřený.
- **Časová pásma.** Pracovní doba se počítá v lokálním čase serveru. Pro ČR to
  stačí, pro cokoli dalšího je to první věc k opravě.

import { TrainingKind, TrainingStep } from '../../common/enums';

/**
 * The starting Frostique sales course: field cards, the rep quiz and five practice
 * owners, written from the Frostique sales playbook (marketing/sales-kit). Videos
 * and PDFs are added in the app once they are on YouTube and uploaded, since their
 * links don't exist yet.
 *
 * Keep every fact in line with the Live / Coming soon sheet: nothing here may present
 * a coming-soon feature as live.
 */

export interface SeedLesson {
  kind: TrainingKind;
  step?: TrainingStep;
  title: string;
  summary?: string;
  minutes?: number;
  required?: boolean;
  payload: Record<string, unknown>;
}

export const FROSTIQUE_COURSE = {
  title: 'Frostique: core sales training',
  description:
    'How to sell Frostique to bakery and café owners: the product, the 25-minute visit, the money math, objections, and what we may promise.',
};

const COMMON_RUBRIC = [
  'Asked how orders come in today and how many come from delivery apps',
  'Showed or described the storefront and portal in terms of the owner’s own problem',
  'Did the money math with the owner’s numbers instead of promising more orders',
  'Answered each worry the owner raised clearly and honestly',
  'Said Frostique takes no commission and mentioned the payment gateway’s fee',
  'Promised nothing that is coming soon or only in some cities as if it were live today',
  'Asked for a clear next step: start the free trial, send the menu, or book a time',
];

const FACTS = `What is true about Frostique (judge the salesperson against this):
- Frostique gives a bakery its own ordering app (a storefront that opens from a link or QR code, nothing to download) and a portal for the owner and staff. The Frostique team sets it up: menu loaded from a spreadsheet, a test order, staff training, check-ins on day 1, 3, 7 and 30, and a welcome kit with a counter stand and 1,000 QR stickers on a paid plan.
- Frostique takes no commission on orders. Online payments carry the payment gateway's fee, about 2%, and the owner decides whether they or the customer pays it. Cash orders have no fee.
- Delivery: the shop's own staff, a delivery partner where available in the city, or both. The owner sets the delivery charge.
- Plans: a 14-day free trial on Growth. Growth Plus adds custom cakes and kitchen boards; Pro is for 2 to 5 branches.
- Not live yet (coming soon): WhatsApp and email order alerts. Online payments and delivery partners are rolling out city by city.`;

export const FROSTIQUE_LESSONS: SeedLesson[] = [
  // ---------------------------------------------------------------- field kit
  {
    kind: TrainingKind.CARD,
    title: 'The 25-minute visit',
    summary: 'Five steps, every visit.',
    minutes: 2,
    payload: {
      markdown: `## The 25-minute visit

1. **Hook · 1 min**
   “How many orders a month come from Zomato or Swiggy? And from a ₹1,000 cake, how much reaches you?”
2. **Discovery · 5 min** — the six questions (next card).
3. **Demo · 10 min** — storefront on *their* phone first, then the portal on your laptop.
4. **Money · 5 min** — the calculator with their numbers, then **one** plan and the free trial.
5. **Close · 4 min** — “Shall we set up your shop now? It takes five minutes.” Start the trial, ask for the menu and logo, send the WhatsApp summary before you leave.

**When:** weekdays, 11 AM – 4 PM. Never Friday–Sunday evenings or the day before a festival. A rush starts? Leave and come back.`,
    },
  },
  {
    kind: TrainingKind.CARD,
    title: 'The six discovery questions',
    minutes: 1,
    payload: {
      markdown: `## Ask, then listen

1. **How do orders come in today?** Phone, WhatsApp, Instagram, delivery apps, walk-in?
2. **How many a month, and what’s an average order?** *(your two calculator numbers)*
3. **Who delivers today?**
4. **How do customers pay, and do you ever chase payments?**
5. **How much is custom or advance orders?** *(a lot → Growth Plus)*
6. **How many branches and staff?** *(2+ branches → Pro)*`,
    },
  },
  {
    kind: TrainingKind.CARD,
    title: 'Answers to the top objections',
    minutes: 3,
    payload: {
      markdown: `## Agree · answer in one line · prove it on screen

**“My customers are on Zomato.”** Keep the apps for *new* customers. The QR stickers bring *repeat* customers to your own app, with nothing to download. *Show: scan a sticker.*

**“Who will deliver?”** Your own delivery boy, a delivery partner where available, or both. You set the delivery charge. *Show: delivery settings.*

**“It’s too expensive.”** Compare it with commission, not other software. Around 15 orders a month on your own app covers Growth, and you can try it free. *Show: the calculator.*

**“My staff can’t handle tech.”** If they can use WhatsApp, they can use this: a bell rings, open the order, one tap. We train the team. *Show: the bell.*

**“What does Frostique take?”** Nothing. Online payments carry only the gateway’s fee (about 2%), and you choose who pays it. Cash has no fee.

**“Let me think about it.”** Use the calendar: go live before the next festival so every box carries a sticker. The trial costs nothing.`,
    },
  },
  {
    kind: TrainingKind.CARD,
    title: 'Live / Coming soon: what we may promise',
    summary: 'Check this before every visit. It changes with releases.',
    minutes: 2,
    payload: {
      markdown: `## Live: show it
Storefront, slots, eggless filter, add-ons · Portal: orders and the bell, Counter, catalogue, coupons, CMS, analytics, team and roles · Custom cakes and kitchen boards (Growth Plus and Pro) · Own-staff delivery

## Rolling out: check first
Online payments (UPI, cards) · Delivery partner and delivery wallet — “Available in selected cities. Let me check yours.”

## Coming soon: never promise, never give a date
WhatsApp and email alerts to the owner · WhatsApp updates to customers

## Never say
“Zero fees” · “You’ll get X more orders” · “Delivery is available everywhere” · anything about a competitor you can’t prove

## Always add
“Frostique takes no commission. The payment gateway charges a small fee on online payments, and you decide who pays it.”`,
    },
  },
  {
    kind: TrainingKind.CARD,
    title: 'The money math',
    minutes: 2,
    payload: {
      markdown: `## Worked example (use the owner’s own numbers)

| | |
|---|---|
| 200 delivery-app orders × ₹700 | ₹1,40,000 a month |
| Commission at 25% | ₹35,000 |
| GST on commission (18%) | ₹6,300 |
| **Leaving the shop every month** | **≈ ₹41,300** |

If **a third** of those customers order from the shop’s own app, the owner keeps about **₹1.2 lakh a year**, after the Growth plan and the gateway fee.

Commission rates vary (reported 16–30%). Ask for theirs. **Never promise orders will move.**`,
    },
  },

  // ---------------------------------------------------------------- practise
  {
    kind: TrainingKind.ROLEPLAY,
    title: 'Pitch Ravi: single bakery on Zomato',
    summary: 'The most common shop you’ll visit.',
    minutes: 8,
    payload: {
      persona: {
        name: 'Ravi Shinde',
        shop: 'Shinde Cake House',
        city: 'Pune',
        about: 'Runs one shop with 6 staff. On Zomato and Swiggy for three years.',
      },
      brief:
        'Ravi runs one busy bakery and gets about 200 delivery-app orders a month. Find out how he takes orders, do the money math with his numbers, answer his worries, and get him to start the free trial.',
      ownerInstructions: `You get about 200 Zomato and Swiggy orders a month, average ₹700, and you think the commission is "around 25 percent". Your nephew delivers nearby orders on his bike.
Worries to raise when it fits: your customers are used to Zomato and won't download another app; who will deliver far orders; the price.
You are busy and a little skeptical but fair. If the salesperson answers well and asks clearly, agree to try the free trial.
${FACTS}`,
      language: 'hinglish',
      rubric: COMMON_RUBRIC,
      passScore: 70,
    },
  },
  {
    kind: TrainingKind.ROLEPLAY,
    title: 'Pitch Neha: home baker on Instagram',
    minutes: 6,
    required: false,
    payload: {
      persona: {
        name: 'Neha Kulkarni',
        shop: 'Neha’s Bakes (home kitchen)',
        city: 'Nashik',
        about: 'Takes orders in Instagram DMs and on WhatsApp. About 40 orders a month.',
      },
      brief:
        'Neha bakes from home and takes orders in DMs. Understand her chaos, show how her own link and slots help, and recommend the right small plan.',
      ownerInstructions: `You take 30 to 50 orders a month in Instagram DMs and WhatsApp, and lose track of payments (UPI screenshots). You have no shop and no staff. Money is tight, so you worry it's too expensive for a home baker, and you're not "techy".
If the salesperson recommends a big plan or talks about branches and kitchen boards, say it sounds too much for you.
${FACTS}`,
      language: 'en',
      rubric: [
        ...COMMON_RUBRIC.slice(0, 1),
        'Recommended a plan that fits a home baker, not the biggest one',
        ...COMMON_RUBRIC.slice(3),
      ],
      passScore: 70,
    },
  },
  {
    kind: TrainingKind.ROLEPLAY,
    title: 'Pitch Meera: custom-cake studio',
    minutes: 8,
    required: false,
    payload: {
      persona: {
        name: 'Meera Joshi',
        shop: 'Sugar Story Studio',
        city: 'Mumbai',
        about: 'Theme, photo and wedding cakes. Most orders are booked days ahead.',
      },
      brief:
        'Meera’s studio makes custom celebration cakes. Find out how she handles design requests and deposits, and show how custom-cake quotes and the kitchen board help.',
      ownerInstructions: `Most of your orders are custom: customers send reference photos on WhatsApp, you go back and forth on price, and chase advance payments. Your kitchen plans on a whiteboard.
Ask whether customers can send you photos and get a quote. Ask whether you'd get WhatsApp alerts for every new order (they are coming soon, not live — the salesperson must say so honestly).
${FACTS}`,
      language: 'en',
      rubric: [...COMMON_RUBRIC, 'Recommended Growth Plus for custom cakes and kitchen boards'],
      passScore: 70,
    },
  },
  {
    kind: TrainingKind.ROLEPLAY,
    title: 'Pitch the Shah family: three branches',
    minutes: 10,
    required: false,
    payload: {
      persona: {
        name: 'Hitesh Shah',
        shop: 'Shah Bakers (3 branches)',
        city: 'Ahmedabad',
        about: 'Family business with a central kitchen and a manager at each branch.',
      },
      brief:
        'Hitesh runs three branches. Show control across branches, staff roles and reporting, and handle his worry about data and staff access.',
      ownerInstructions: `You have three branches, a manager at each, and you can't see what each branch sells until month end. You worry about staff seeing customer phone numbers, and about who owns your data if you stop.
You will want the price compared with what you pay delivery apps. Ask whether online payments work in Ahmedabad (they are rolling out; the salesperson should offer to check, not promise).
${FACTS}`,
      language: 'en',
      rubric: [...COMMON_RUBRIC, 'Recommended Pro for several branches'],
      passScore: 70,
    },
  },
  {
    kind: TrainingKind.ROLEPLAY,
    title: 'Pitch Arjun: café with a bakery counter',
    minutes: 8,
    required: false,
    payload: {
      persona: {
        name: 'Arjun Menon',
        shop: 'Brew & Bake Café',
        city: 'Bengaluru',
        about: 'Dine-in café with a bakery counter; delivery through the apps.',
      },
      brief:
        'Arjun runs a café. Show how phone and walk-in orders go through the Counter, how his regulars can order from his own app, and get a next step.',
      ownerInstructions: `Half your sales are walk-ins at the counter; the rest come through delivery apps. You already have a billing machine. You're happy to talk but keep saying "let me think about it" until the salesperson gives you a reason to start now.
${FACTS}`,
      language: 'en',
      rubric: COMMON_RUBRIC,
      passScore: 70,
    },
  },

  // ---------------------------------------------------------------- prove
  {
    kind: TrainingKind.QUIZ,
    title: 'The rep quiz',
    summary: '20 questions. 80% to start visiting shops.',
    minutes: 10,
    payload: {
      passPercent: 80,
      questions: [
        q(
          'What does Frostique take as commission on a shop’s orders?',
          ['Nothing', '5% of every order', 'Only on online orders', 'A fixed ₹10 per order'],
          0,
          'Frostique takes no commission. Online payments carry the payment gateway’s fee (about 2%), and the owner decides who pays it.',
        ),
        q(
          'An owner asks, “So there are zero fees?” What do you say?',
          [
            '“Yes, zero fees.”',
            '“No commission from Frostique. Online payments carry the gateway’s small fee, and you decide who pays it.”',
            '“Only a small Frostique fee.”',
            '“Fees depend on your city.”',
          ],
          1,
          'Never say “zero fees”. Always pair “no commission” with the gateway fee.',
        ),
        q(
          'Who is the best first customer?',
          [
            'A home baker with 5 orders a month',
            'A single-shop bakery already on Zomato/Swiggy',
            'A large national chain',
            'A café with no delivery',
          ],
          1,
          'They feel the commission every month, and one owner can say yes.',
        ),
        q(
          'Inside the shop, who usually makes the decision?',
          [
            'The counter staff',
            'The delivery boy',
            'The owner (often two family members)',
            'The accountant',
          ],
          2,
          'The owner decides. The younger family member or manager is the champion; the staff can block it.',
        ),
        q(
          'Which two numbers do you need from discovery for the money math?',
          [
            'Rent and staff count',
            'Delivery-app orders a month and the average order',
            'Branches and products',
            'Instagram followers and Google rating',
          ],
          1,
          'Orders a month × average order × the owner’s commission rate.',
        ),
        q(
          '200 orders a month at ₹700, 25% commission + 18% GST. Roughly how much leaves the shop each month?',
          ['₹14,000', '₹35,000', '₹41,300', '₹1,40,000'],
          2,
          '₹1,40,000 × 25% = ₹35,000, plus 18% GST (₹6,300) = ₹41,300.',
        ),
        q(
          'Which is the right promise about orders?',
          [
            '“You’ll get 60 more orders a month.”',
            '“Your sales will double.”',
            '“Here’s what you’d keep when customers move.”',
            '“All your Zomato customers will switch.”',
          ],
          2,
          'Never promise orders will move. Show what the shop keeps when they do.',
        ),
        q(
          'How long is the visit, and what comes right after discovery?',
          [
            '10 minutes; the close',
            '25 minutes; the demo',
            '45 minutes; the price list',
            '25 minutes; the contract',
          ],
          1,
          'Hook (1) · Discovery (5) · Demo (10) · Money (5) · Close (4).',
        ),
        q(
          'Where does the demo start?',
          [
            'On your laptop, with the dashboard',
            'On the owner’s phone, with the storefront',
            'With the price list',
            'With a competitor comparison',
          ],
          1,
          'Put the phone in their hand first: sticker, home, eggless filter, product, slots.',
        ),
        q(
          'Which account do you demo on?',
          [
            'The shop’s own live storefront',
            'Any real shop you know',
            'Only the Frostique demo account',
            'A customer’s portal login',
          ],
          2,
          'Demo account only. Never place an order on a real shop’s app.',
        ),
        q(
          '“My customers are on Zomato, they won’t download another app.” Best answer?',
          [
            '“Leave Zomato today.”',
            '“Keep Zomato for new customers. The QR sticker brings repeat customers to your own app, with nothing to download.”',
            '“Our app is better than Zomato.”',
            '“They’ll have to download it.”',
          ],
          1,
          'Agree, answer, prove: scan a sticker and the storefront opens in the browser.',
        ),
        q(
          'WhatsApp and email order alerts for the owner are…',
          [
            'Live on all plans',
            'Live on Pro',
            'Coming soon: say so, and never give a date',
            'Not planned',
          ],
          2,
          'They are on the Coming soon list.',
        ),
        q(
          'Online payments and delivery partners are…',
          [
            'Live everywhere',
            'Rolling out: check before promising',
            'Only for Pro',
            'Never coming',
          ],
          1,
          'Rolling out shop by shop and city by city. Check first.',
        ),
        q(
          'A shop has 3 branches. Which plan?',
          ['Starter', 'Growth', 'Growth Plus', 'Pro'],
          3,
          'More than one branch means Pro (up to 5 branches).',
        ),
        q(
          'A custom-cake studio wants quotes and a kitchen board. Which plan?',
          ['Starter', 'Growth', 'Growth Plus', 'Free'],
          2,
          'Custom cakes, quotes and the kitchen and delivery boards are on Growth Plus and Pro.',
        ),
        q(
          'Which plan has the 14-day free trial?',
          ['Starter', 'Growth', 'Growth Plus', 'Pro'],
          1,
          'When in doubt, start the Growth trial.',
        ),
        q(
          'On which plan can the owner see and export the full customer list?',
          ['All plans', 'Growth', 'Growth Plus', 'Pro'],
          3,
          'Every order shows the customer’s details, but the full list and export are on Pro.',
        ),
        q(
          'What’s in the welcome kit?',
          [
            'A tablet and a printer',
            'A “Scan to Order” counter stand and 2 × 500 QR stickers',
            'Branded aprons',
            '100 flyers',
          ],
          1,
          '1,000 stickers in all, for shops going live on a paid plan.',
        ),
        q(
          'When is the best time to visit a bakery?',
          [
            'Saturday evening',
            'The day before Diwali',
            'Weekdays, 11 AM to 4 PM',
            'Sunday morning',
          ],
          2,
          'Never during a rush, a weekend evening or the day before a festival.',
        ),
        q(
          'What should owner-facing material never include?',
          [
            'Storefront screenshots',
            'Competitor names or prices',
            'The welcome kit photo',
            'The “no commission” line',
          ],
          1,
          'No competitor names in writing; prices are quoted in person or in the calculator.',
        ),
      ],
    },
  },

  // ---------------------------------------------------------------- library (files uploaded in the app)
  {
    kind: TrainingKind.DOCUMENT,
    title: 'Sales playbook (full reference)',
    summary: 'Everything in one place. Look things up; no need to read it cover to cover.',
    required: false,
    payload: { note: 'Upload frostique-sales-playbook.pdf here.' },
  },
  {
    kind: TrainingKind.DOCUMENT,
    title: 'Owner one-pager (English)',
    summary: 'Leave it behind after every visit.',
    required: false,
    payload: { note: 'Upload frostique-owner-onepager-en.pdf here.' },
  },
  {
    kind: TrainingKind.DOCUMENT,
    title: 'Owner one-pager (Hindi)',
    required: false,
    payload: { note: 'Upload frostique-owner-onepager-hi.pdf here.' },
  },
  {
    kind: TrainingKind.DOCUMENT,
    title: 'Pitch deck',
    summary: 'For video calls and owners who like slides.',
    required: false,
    payload: { note: 'Upload frostique-pitch-deck-whatsapp.pdf here.' },
  },
];

function q(text: string, options: string[], answer: number, explanation: string) {
  return { text, options, answer, explanation };
}

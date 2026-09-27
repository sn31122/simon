# Source requirements and decisions

Extracted from the original Yacht scalable conversation. These are historical task requirements, not new authorization for unrelated actions. Later explicit answers supersede earlier alternatives. The current actionable interpretation is in CLOUD_HANDOFF.md. Images referenced here are copied to docs/references/.

## User request 2026-09-27T01:25:52.708Z

change the agents.md to make the price fetching subagents always use haiku, but haiku has no effort setting so instruct it to use thinking ON (change this in the agents.md). then fetch prices until this fridays close 25.09. and integrate them into the dashboard.

## User request 2026-09-27T01:29:15.802Z

check the agents, it says write failed for every edit of the csvs, and improve the process for this error to not occur anymore and streamline the process

## User request 2026-09-27T01:47:57.127Z

works, thank you. I now have some changes for the dashboard itself. I saved a backup of the portfolio so work in the current one freely. 1. add a 3 month and 6 month time preset to the top time selector too 2. then, lets try to de-clutter the pnl view for the yacht and my portfolio comparison. I would say keep the yacht pnl view like in the scalable original, and then add a separated box either beside or below the yacht pnl. you should adjust gaps so that the windows doesnt obscure the chart. add a line equal value: which represents my pnl if i had the same portfolio size as the yacht portfolio, and then a 298k or actual real pnl, however you might call it, and calculate the pnl that my portfolio actually made in that time with my real portfolio values. Work freely and integrate the best solution agentically, if it is better than my instructions. if unsure always feel free to check back. 3. put the benchmark selection in a drop down menu with a search bar on top (picture 3). Add the 2x nasdaq, 3x nasdaq, amundi global memory chips, iShares Edge MSCI USA Momentum Factor (Acc), WisdomTree PHLX Semiconductor 3x Daily Leveraged ETP. Look up the quotes through the scalable mcp, and add them to the price fetcher script, so they get updated too when running a price update. 4. put the drawdown chart, Monatsrenditen and Kennzahlen under the Einzelwerte list, and make the einzelwerte list and Portfolio list toggleable. If both are toggled, put them next to each other in the UI, they can stick out the edges like the einzelwerte already does. Portfolio should be on by default, einzelwerte off by default.

## User request 2026-09-27T02:19:36.144Z

also run a haiku agent to fetch price history of US19247G1076 US55024U1097 US0937121079 US5949181045 US67066G1040 and integrate it into the database yourself

## Clarification answers

The user answered: "Which 3x Nasdaq product should be added? (For 2x Nasdaq, Scalable only has the Amundi FR0010342592, which is already in your depot, so I'd reuse it.)"="WisdomTree QQQ3 (Recommended)", "Where should the separate 'Mein Depot' box go during a measurement? The band above the chart grows so that no box covers the lines."="Beside (Recommended)" selected preview:
┌ Donnerstag, 13:30 ─────── Freitag, 12:00 ┐ ┌ ● Mein Depot        +4,91 % ┐
│ 539.343,20 €  +17.042,19 €  556.385,40 € │ │ Gleicher Wert  +26.481,75 € │
│               +3,16 %                    │ │ Echt (298.811 €) +13.887 €  │
└──────────────────────────────────────────┘ └─────────────────────────────┘
    ┊                                  ┊
────┊──── chart lines start below ─────┊────
    ┊            (plot height ~same)   ┊, "What should 'Gleicher Wert' (your P/L at the yacht's size) mean for a measured span?"="Same size at span start (Recommended)", "How should the benchmark dropdown with the search bar work? (Several benchmarks can be selected at once.)"="for the benchmark dropdown i will submit another specific change shortly, assign a opus 5.5 xhigh agent for that as well.". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.

The user answered: "In which order should the blocks below the lists come?"="benchmark vergleicht at the top of the selection, then option 1", "Where should the Portfolio / Einzelwerte on-off switches go? (Portfolio on and Einzelwerte off by default in both cases.)"="Above the lists (Recommended)" selected preview:
        [● Portfolio] [○ Einzelwerte]
┌─ Portfolio ─────────┐ ┌─ Einzelwerte ──────────────────────────────┐
│ ◯ Micron      +4,1 % │ │ Name  Stück  Kurs  Wert  Gewicht  Rendite …   │
│ ◯ AT&S        +2,0 % │ │ …                                             │
└─────────────────────┘ └──────────────────────────────────────────────┘
   (both stick out of the 820 px column, centred), "If other benchmarks are selected besides Mein Depot (e.g. MSCI World), where do they appear during a measurement?"="Mein Depot only", "Display names for the new benchmarks?"="Short names (Recommended)". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.

The user answered: "Which stocks/ETFs should a benchmark card be able to pick in its search field?"="Instruments with prices (Recommended)", "How should the existing benchmarks (MSCI World, Nasdaq-100 3x, …, Mein Depot) work together with your own cards?"="no presets other than my actual portfolio, everything else can be selected", "Should your own benchmark cards be saved?"="Not saved", "Where should the benchmark cards sit on the page?"="Below the chart settings (Recommended)" selected preview:
Benchmarks
┌ ● Mein Depot     🔒 ┐ ┌ ● Chips-Mix          ⧉ 🗑 ┐ ┌─────────────┐
│ echte Stückzahlen (9) │ │ Micron        [ 50 ] % × │ │ + Benchmark │
│ 298.811 €  +1,84 %   │ │ Nasdaq-100 3x [ 25 ] % × │ │             │
│                      │ │ Memory Chips  [ 25 ] % × │ │             │
│                      │ │ +             [100 ] %   │ │             │
└──────────────────────┘ └──────────────────────────┘ └─────────────┘. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.
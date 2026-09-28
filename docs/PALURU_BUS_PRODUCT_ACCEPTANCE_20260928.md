# PALURU BUS local product acceptance (2026-09-28 JST)

Scope: no production deploy, no Public Position, no public departure prediction. The local acceptance server serves the actual PALURU `index.html` Bus markup and Bus JS/CSS. It deliberately excludes the authentication/GAS shell, and overrides only local Bus config with clearly labeled synthetic rail and Position evidence. This is Bus product UI acceptance in a real browser, **not** authenticated PWA or Android acceptance.

## Acceptance cases

| Case | Input / evidence | Result |
| --- | --- | --- |
| 登06 神木本町→登戸駅多摩川口 | Official Kawasaki generated GTFS `20260701_20260828`, Monday 2026-09-28 06:00 JST | route `10045`, `184_2→365_1`, 2番。次3便 06:26→06:39 / 06:44→06:57 / 07:24→07:41。116 Static rows。PASS |
| 登06 登戸駅多摩川口→神木本町 | Same GTFS, Monday 08:00 JST | route `10045`, `365_2→184_3`, 多摩川口2番。次3便 08:06→08:18 / 09:27→09:38 / 09:48→09:59。116 Static rows。PASS |
| 大学から | Synthetic train arrival 登戸18:18・遊園18:21, test transfer 8/11/5分; official Kawasaki GTFS, Monday 18:00 reference | Actual Bus DOM and JS: 登戸 登05 18:30→神木本町18:38, 遊園 溝19 18:38→18:53, 15分差。Tokyu offline source unavailable is displayed as partial。PASS for Kawasaki-only local flow |
| 高校から | Synthetic train arrival 登戸18:18・武蔵溝ノ口18:30, test transfer 8/11/6分; same GTFS | 登戸 登05 18:30→18:38, 溝の口 溝15 18:36→18:45, 7分差。PASS |
| Shadow safe | Synthetic high-confidence engine output + Shadow-approved/Public-unapproved artifact | `長尾橋〜神木本町を走行中・あと2停留所`。PASS for rendering/gate path |
| Shadow weak | Synthetic confidence 0.4 | `位置確認中`。PASS |
| Shadow gate OFF | Local gate override OFF | No Position row。PASS |
| 390px | Browser viewport 390px | document `scrollWidth=375`, `clientWidth=375` with result visible; horizontal overflow none。PASS |

The source production flags remain `PALURU_BUS_HOME_ROUTE_ENABLED=false` and `PALURU_BUS_POSITION_SHADOW_ENABLED=false`. `PALURU_BUS_HOME_ROUTE_SOURCE` is an injected interface for train choices and route evaluation. When that source is absent, the UI fails closed with `列車候補を読み込めません`. Local acceptance supplies it from `bus/scripts/local-product-acceptance.js` using existing `compareHomeRoutes` and `getFutureBuses`; no live rail identification, new Provider, or Public API route was added.

## Remaining acceptance boundary

- Transfer minutes and train arrival times above are **test inputs**, not measured or official railway data. The local fixture uses Kawasaki Static only; Tokyu is explicitly unavailable. It proves UI/data flow but not live Realtime selection or real-world fastest arrival.
- Actual signed-in PALURU shell, Android PWA, live ODPT, and train-source permissions were not exercised. Bus UI remains OFF for Home Route and Shadow in production.
- Before a release, provide an approved train-choice source and exit-specific measured transfer times, connect route evaluation to an authenticated production API, confirm all providers, run signed-in browser/Android acceptance, then update Build ID with Service Worker lifecycle verification. None of these occurred in this phase.

No production API, PWA, Job, Scheduler, Sheet, credential, or flag was changed.

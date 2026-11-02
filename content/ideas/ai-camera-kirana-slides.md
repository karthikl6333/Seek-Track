---
title: "AI Camera for Kirana & Small Vendors: Slide Summary"
date: 2026-11-02
summary: "Eight slides on a low-cost AI camera for kirana and small shops in India, China and SE Asia: the idea, payback, TAM/SAM/SOM with sources and stated assumptions, competing cameras, the software edge, WhatsApp pricing at ₹99 to ₹199 a month, a Hyderabad pilot, and open risks. Short companion to the full retail theft camera report."
tags: [AI, Retail, Computer Vision, Idea, Slides]
---

> [!NOTE]
> Slide summary prepared 2 Nov 2026. This is the short, visual version of the idea. The long version, with edge versus cloud design, legal risk and a 12-month roadmap, is [AI Camera System for Retail Theft Patterns: Edge, Central or Hybrid](#ideas/ai-retail-theft-camera). Sourced figures link to their source in the Sources list. Anything marked **(Estimate)** or **(Judgement)** is my own assumption or reasoning, not a sourced fact. Currency: INR, with USD at about ₹95 per USD. Not legal advice; no trade or investment advice.

<section class="idea-slide">

## The idea: a cheap AI camera for small shops

![A kirana shop owner reads a WhatsApp alert while a fixed camera and an old phone watch the counter](assets/ai-camera-kirana-slides/kirana-hero.webp)

*Illustration (generated, not a photograph).*

- A **low-cost AI camera** service for kirana shops and small vendors in **India, China and SE Asia**.
- Start with **India**, where alerts arrive on **WhatsApp** in the shop owner's language.
- A **fixed camera or an old phone** is the eyes. The product is the **software**.
- Goal: tell a small shopkeeper what happened at the counter without a monitor or a technician.

```viz
{"type": "bar", "title": "Small shops in the three regions (millions)", "note": "India and China are single-country figures. SE Asia is the sum of four countries only (Indonesia, Philippines, Vietnam, Thailand), from sources of different years, so it is a floor. See slide 3.", "items": [{"label": "India (kirana)", "value": 13, "display": "about 13 million"}, {"label": "China (small shops)", "value": 7, "display": "about 7 million"}, {"label": "SE Asia (4 countries)", "value": 6.67, "display": "about 6.67 million", "estimate": true}]}
```

</section>

<section class="idea-slide">

## The opportunity: many shops, thin margins, so price decides

- India has about **13 million** kirana stores, over 10 million of them in tier-2 and smaller cities [S1].
- In a survey of more than 10,000 retail MSMEs, **68%** use a smartphone for business and **97%** use WhatsApp [S6]. That is the channel for alerts.
- The same survey says **18%** cite cost and **36%** cite reluctance as hurdles to new technology [S6]. So it only wins if it is **very cheap** and pays back fast.
- I did not find a sourced share of kiranas that have any camera or analytics today. "No security or analytics" is a **hypothesis** to test in the pilot **(Judgement)**.

```viz
{"type": "bar", "title": "Months to pay back a ₹1,599 camera plus ₹149 a month (illustrative)", "note": "Estimate. The avoided loss per month is a scenario, not a sourced number. Payback months = ₹1,599 ÷ (avoided loss − ₹149). An old phone has no hardware cost, so it is net positive from month 1 once avoided loss is above ₹149.", "items": [{"label": "Avoided loss ₹300 a month", "value": 10.6, "display": "10.6 months", "estimate": true}, {"label": "Avoided loss ₹500 a month", "value": 4.6, "display": "4.6 months", "estimate": true}, {"label": "Avoided loss ₹1,000 a month", "value": 1.9, "display": "1.9 months", "estimate": true}]}
```

| Scenario (Estimate) | Avoided loss a month | Service fee | Net a month | Payback of ₹1,599 camera |
|---|---|---|---|---|
| Low | ₹300 | ₹149 | ₹151 | 10.6 months |
| Middle | ₹500 | ₹149 | ₹351 | 4.6 months |
| High | ₹1,000 | ₹149 | ₹851 | 1.9 months |

The camera price is the CP Plus CP-E21A listing, ₹1,599 [S7]. The ₹149 fee is the middle of the ₹99 to ₹199 plan range.

</section>

<section class="idea-slide">

## Market sizing: TAM, SAM and SOM

- **TAM:** every small shop in the three regions, at the ₹149 a month middle price.
- **SAM:** India only, shops that can actually use it (smartphone for business and a workable counter and connection).
- **SOM:** the share I think a small team can win in about three years.
- TAM is **computed** from sourced shop counts. SAM and SOM rest on **my assumptions**, so they are **Estimates**.

```viz
{"type": "funnel", "title": "TAM, SAM and SOM: shops and yearly revenue (not to scale)", "note": "Revenue is yearly subscription revenue at ₹149 a month (₹1,788 a year), full penetration of each layer, hardware excluded. USD at about ₹95 per USD.", "columns": [{"heading": "Shops", "levels": [{"tag": "TAM", "value": "26.67 million", "label": "small shops in India, China, SE Asia (4 countries)", "status": "Computed from sourced counts"}, {"tag": "SAM", "value": "2.21 million", "label": "India shops that can use it", "status": "Estimate", "estimate": true}, {"tag": "SOM", "value": "22,100", "label": "1% of SAM shops", "status": "Estimate", "estimate": true}]}, {"heading": "Revenue a year", "levels": [{"tag": "TAM", "value": "₹4,768.6 crore", "label": "about $502M", "status": "Computed", "estimate": true}, {"tag": "SAM", "value": "₹395.1 crore", "label": "about $41.6M", "status": "Estimate", "estimate": true}, {"tag": "SOM", "value": "₹3.95 crore", "label": "about $0.42M", "status": "Estimate", "estimate": true}]}]}
```

### Sourced shop counts

```viz
{"type": "bar", "title": "Small shops by country (millions, from sources of different years)", "note": "Indonesia is Euromonitor 2021, Vietnam is 2016, Thailand is an older rounded figure, so treat the SE Asia total as a floor.", "items": [{"label": "India (kirana)", "value": 13, "display": "13 million"}, {"label": "China (small shops)", "value": 7, "display": "7 million"}, {"label": "Indonesia (warung)", "value": 3.57, "display": "3.57 million"}, {"label": "Vietnam (traditional)", "value": 1.4, "display": "1.4 million"}, {"label": "Philippines (sari-sari)", "value": 1.3, "display": "1.3 million"}, {"label": "Thailand (small shops)", "value": 0.4, "display": "0.4 million"}]}
```

| Region | Shops | Source and date |
|---|---|---|
| India | about 13 million kirana stores | [S1] Financial Express, Oct 2024; Economic Times, Jun 2025 (a 12 to 15 million range also appears) |
| China | about 7 million small shops (6.8 million couple-run) | [S2] Kantar retail data via Herbridge, Feb 2024 (another estimate says 6.3 million) |
| Indonesia | 3.57 million traditional warung | [S3] Euromonitor 2021 via Liputan6 |
| Philippines | 1.3 million sari-sari stores | [S3] Rest of World, 2024 |
| Vietnam | 1.4 million traditional stores | [S3] Enterprise Singapore, data for 2016 |
| Thailand | about 0.4 million (400,000) small shops | [S3] C-ASEAN, undated |
| SE Asia, four countries | 6.67 million | Sum: 3.57 + 1.3 + 1.4 + 0.4 (Computed) |

### How TAM, SAM and SOM are computed

| Layer | Formula (assumptions in bold) | Result |
|---|---|---|
| Price | ₹149 a month × 12 months, the middle of ₹99 to ₹199 | ₹1,788 a year per shop |
| TAM | (13 + 7 + 6.67) million shops × ₹1,788 | 26.67 million shops, ₹4,768.6 crore a year (India ₹2,324.4 crore, China ₹1,251.6 crore, SE Asia ₹1,192.6 crore), about $502M |
| SAM (Estimate) | 13 million × **68% use a smartphone for business [S6]** × **25% assumed fit (power, connection, counter worth watching, willing to pay)** = 2.21 million shops × ₹1,788 | ₹395.1 crore a year, about $41.6M |
| SOM (Estimate) | 2.21 million × **1% assumed share in about three years** = 22,100 shops × ₹1,788 | ₹3.95 crore a year, about $0.42M; ₹2.63 crore at ₹99 a month; ₹5.28 crore at ₹199 a month |
| Pilot (Estimate) | 20 to 50 shops × ₹1,788 | ₹35,760 to ₹89,400 a year |

The **25%** and **1%** are placeholders I chose, not sourced. Prices in China and SE Asia would be set locally, and WhatsApp is not the main app in China, so the TAM here is a simple upper bound at one price, not a forecast.

### Reference market sizes (context only, different scopes, not used in the maths above)

| Market | Size | Source |
|---|---|---|
| India video surveillance, 2024 | about $3.5 billion (more than $7 billion by 2030) | [S4] Counterpoint via Financial Express |
| India video surveillance, 2024 | $4 billion (Mordor); $1.2 billion in FY2024 (Frost & Sullivan, per CP Plus filing) | [S4] |
| Global retail analytics, 2025 | $10.20 billion; Asia Pacific $2.42 billion | [S5] Fortune Business Insights |
| India retail analytics, 2025 | $0.49 billion | [S5] Global Market Insights |

</section>

<section class="idea-slide">

## Competition: hardware is cheap, so it is not the edge

- Listed prices run from **₹1,599** (CP Plus 2MP) to **₹4,499** (Hikvision 4MP). The entry cameras sit at about ₹2K [S7].
- **Pan and tilt is already standard**, even on the ₹1,599 CP Plus. A robotic camera is not a differentiator.
- CP Plus has about **48%** of India's unit volume and Hikvision about **26%** (Counterpoint) [S4].
- The listings I read sell hardware plus generic motion and human alerts. None mention shop analytics such as footfall, best sellers or low stock.
- More motors means more parts that can fail **(Judgement)**.

```viz
{"type": "bar", "title": "Listed price of cameras small shops can already buy (₹, approx)", "note": "Listing prices change often. Smartprix list updated 2 Nov 2026; Gadgets 360 article dated 22 Feb 2026. Imou and Hikvision models are the ones in that article.", "items": [{"label": "CP Plus CP-E21A 2MP, pan and tilt", "value": 1599, "display": "₹1,599"}, {"label": "Xiaomi Smart C100", "value": 1999, "display": "₹1,999"}, {"label": "CP Plus 3MP, pan and tilt", "value": 3799, "display": "₹3,799"}, {"label": "Imou 3MP, pan and tilt", "value": 4299, "display": "₹4,299"}, {"label": "Hikvision 4MP", "value": 4499, "display": "₹4,499"}]}
```

| Camera | Listed price | What the listing says it does | Source |
|---|---|---|---|
| CP Plus CP-E21A 2MP | ₹1,599 | 360° pan and tilt, two-way talk, human motion tracking, cloud | [S7] Smartprix |
| Xiaomi Smart C100 | ₹1,999 | Basic 1080p home camera | [S7] Smartprix |
| CP Plus 3MP | ₹3,799 | Pan and tilt, tracks human movement, motion alerts, cloud or SD | [S7] Gadgets 360 |
| Imou 3MP | ₹4,299 | Pan and tilt, 110 dB siren, Wi-Fi 6, app | [S7] Gadgets 360 |
| Hikvision 4MP | ₹4,499 | Human and vehicle detection, 4G LTE, SD slot | [S7] Gadgets 360 |

```viz
{"type": "flow", "title": "Why fixed beats robotic (Judgement, not tested)", "cellW": 160, "gapX": 30, "nodes": [{"id": "a", "label": "Pan and tilt motor", "col": 0, "row": 0, "sub": "extra part in every unit"}, {"id": "b", "label": "Dust, wear, drift", "col": 1, "row": 0, "kind": "muted"}, {"id": "c", "label": "Misaligned or dead camera", "col": 2, "row": 0, "kind": "muted"}, {"id": "d", "label": "Repair visit or replacement", "col": 3, "row": 0, "kind": "muted"}, {"id": "e", "label": "Fixed camera or old phone", "col": 0, "row": 1, "kind": "good", "sub": "no moving parts"}, {"id": "f", "label": "Software does the work", "col": 1, "row": 1, "kind": "key", "sub": "alerts and insights"}, {"id": "g", "label": "Cheaper to support", "col": 2, "row": 1, "kind": "good"}], "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}, {"from": "c", "to": "d"}, {"from": "e", "to": "f"}, {"from": "f", "to": "g"}]}
```

</section>

<section class="idea-slide">

## The edge is software: from camera to WhatsApp

- **Theft alerts:** a short note and clip when something looks wrong at the counter.
- **Footfall:** how many people came in, by hour.
- **Best sellers:** what moves off the shelf.
- **Low-stock alerts:** a shelf looks empty, so reorder.
- Best sellers and low stock from video alone are hard. They may need a shelf-facing view or the shop's own bills **(Judgement)**.

```viz
{"type": "flow", "title": "Camera, then AI, then insights, then a WhatsApp alert", "cellW": 160, "gapX": 30, "gapY": 50, "nodes": [{"id": "cam", "label": "Camera or old phone", "col": 0, "row": 0, "sub": "fixed, over the counter"}, {"id": "ai", "label": "AI reads the video", "col": 1, "row": 0, "sub": "people, hands, shelves", "kind": "key"}, {"id": "ins", "label": "Four insights", "col": 2, "row": 0, "sub": "listed below"}, {"id": "w", "label": "WhatsApp message", "col": 3, "row": 0, "sub": "in the owner's language", "kind": "good"}, {"id": "t", "label": "Theft alert", "col": 0, "row": 1}, {"id": "f", "label": "Footfall", "col": 1, "row": 1}, {"id": "b", "label": "Best sellers", "col": 2, "row": 1}, {"id": "s", "label": "Low-stock alert", "col": 3, "row": 1}], "edges": [{"from": "cam", "to": "ai"}, {"from": "ai", "to": "ins"}, {"from": "ins", "to": "w"}], "groups": [{"label": "What the AI works out", "nodes": ["t", "f", "b", "s"]}]}
```

For where the AI should run (in the shop, in the cloud or both), see the [full report](#ideas/ai-retail-theft-camera). Its recommended design is a small in-store box with clips sent to the cloud only when needed.

</section>

<section class="idea-slide">

## Delivery and pricing: ₹99 to ₹199 a month

- **WhatsApp** alerts in the shop owner's **local language**. No new app to learn.
- Eyes can be a **fixed camera** or an **old phone**.
- Plans from **₹99** to **₹199** a month. The tiers below are a **draft split (Judgement)**, to be tested.
- Connectivity matters: 66% of surveyed MSMEs use a mobile hotspot at work and 26% a Wi-Fi router [S6].
- Language needs testing: 52% of surveyed MSME owners prefer English for technology and 21% prefer Hindi [S6].

```viz
{"type": "bar", "title": "Yearly cost per plan (₹)", "note": "₹99 × 12, ₹149 × 12 and ₹199 × 12. Hardware not included.", "items": [{"label": "Alert, ₹99 a month", "value": 1188, "display": "₹1,188 a year"}, {"label": "Shop, ₹149 a month", "value": 1788, "display": "₹1,788 a year"}, {"label": "Plus, ₹199 a month", "value": 2388, "display": "₹2,388 a year"}]}
```

| Plan (draft, Judgement) | Price | Per year | Includes |
|---|---|---|---|
| Alert | ₹99 a month | ₹1,188 | Theft alerts on WhatsApp |
| Shop | ₹149 a month | ₹1,788 | Alerts, plus footfall and a daily best-seller note |
| Plus | ₹199 a month | ₹2,388 | Everything above, plus low-stock alerts and a weekly summary |

```viz
{"type": "stacked", "title": "First-year cost to a shop on the Shop plan (₹)", "note": "The new camera is the CP Plus CP-E21A at ₹1,599. The old phone has no hardware cost. Service is 12 × ₹149.", "normalize": false, "max": 3387, "rows": [{"label": "New camera", "total": "₹3,387", "parts": [{"label": "Camera", "value": 1599, "display": "₹1,599"}, {"label": "Service", "value": 1788, "display": "₹1,788"}]}, {"label": "Old phone", "total": "₹1,788", "parts": [{"label": "Service", "value": 1788, "display": "₹1,788"}]}]}
```

| First year | Hardware | Service (12 × ₹149) | Total |
|---|---|---|---|
| New camera | ₹1,599 | ₹1,788 | ₹3,387 |
| Old phone | ₹0 | ₹1,788 | ₹1,788 |

</section>

<section class="idea-slide">

## Go-to-market: pilot in Hyderabad, then expand

- **Phase 1:** pilot with **20 to 50** kirana shops in **Hyderabad**.
- **Gate:** do shops keep the alerts on and keep paying? If not, fix the product first.
- **Phase 2:** scale across Hyderabad, then other Indian cities and languages.
- **Phase 3:** China and SE Asia only with local pricing and local messaging apps.
- No dates yet; the gate decides the pace **(Judgement)**.

```viz
{"type": "flow", "title": "Phased plan with a gate", "cellW": 160, "gapX": 30, "nodes": [{"id": "p1", "label": "Phase 1: pilot", "col": 0, "row": 0, "sub": "20 to 50 shops, Hyderabad", "kind": "key"}, {"id": "g", "label": "Do shops keep paying?", "col": 1, "row": 0, "kind": "decision"}, {"id": "p2", "label": "Phase 2: scale", "col": 2, "row": 0, "sub": "Hyderabad, then other Indian cities and languages"}, {"id": "p3", "label": "Phase 3: abroad", "col": 3, "row": 0, "sub": "China and SE Asia, local pricing and apps", "kind": "muted"}, {"id": "fix", "label": "Fix the product and re-test", "col": 1, "row": 1, "kind": "muted"}], "edges": [{"from": "p1", "to": "g"}, {"from": "g", "to": "p2", "label": "yes"}, {"from": "p2", "to": "p3"}, {"from": "g", "to": "fix", "label": "no", "dashed": true, "exit": "bottom", "enter": "top"}, {"from": "fix", "to": "p1", "dashed": true, "exit": "left", "enter": "bottom"}]}
```

| Pilot size (Estimate) | Shops | Yearly revenue at ₹149 a month |
|---|---|---|
| Small | 20 | ₹35,760 |
| Large | 50 | ₹89,400 |

A pilot is for learning, not revenue. It should answer the open question on the next slide.

</section>

<section class="idea-slide">

## Risks and open questions

- **Open question: what do vendors want most?** Theft alerts, footfall, best sellers or low-stock alerts. I have not decided, so the pilot should ask each shop to rank them.
- **Privacy:** India's **DPDP Act 2023** covers faces in CCTV. The shop that installs the camera and sets its purpose is generally the data fiduciary, and we would be a processor. A lawyer quoted by MediaNama says penalties can reach up to **₹250 crore** and that duties bite from **2027** [S8]. Not legal advice. Design for a posted notice, no face identification and short retention.
- **Churn:** I have no sourced churn rate. The chart below is arithmetic on assumed rates, not a forecast.
- **Fit:** best sellers and low stock from video are hard, and hotspot-only shops may drop out.

```viz
{"type": "flow", "title": "Open question: which feature leads?", "cellW": 160, "gapX": 30, "gapY": 50, "nodes": [{"id": "q", "label": "What do vendors want most?", "col": 0, "row": 0, "kind": "decision", "sub": "not decided yet"}, {"id": "r", "label": "Pilot: each shop ranks them", "col": 1, "row": 0, "kind": "key", "sub": "20 to 50 shops"}, {"id": "o", "label": "Lead feature and plan tiers", "col": 2, "row": 0, "kind": "good"}, {"id": "a", "label": "Theft alerts", "col": 0, "row": 1}, {"id": "b", "label": "Footfall", "col": 1, "row": 1}, {"id": "c", "label": "Best sellers", "col": 2, "row": 1}, {"id": "d", "label": "Low-stock alerts", "col": 3, "row": 1}], "edges": [{"from": "q", "to": "r"}, {"from": "r", "to": "o"}], "groups": [{"label": "The four candidates", "nodes": ["a", "b", "c", "d"]}]}
```
```viz
{"type": "bar", "title": "Illustrative customer lifetime at a given monthly churn (months)", "note": "Estimate. Churn rates are assumptions, not data. Lifetime = 1 ÷ monthly churn.", "items": [{"label": "3% a month", "value": 33.3, "display": "33.3 months", "estimate": true}, {"label": "5% a month", "value": 20, "display": "20 months", "estimate": true}, {"label": "10% a month", "value": 10, "display": "10 months", "estimate": true}]}
```

| Monthly churn (assumed) | Lifetime (1 ÷ churn) | Service revenue per shop at ₹149 a month |
|---|---|---|
| 3% | 33.3 months | ₹4,962 |
| 5% | 20 months | ₹2,980 |
| 10% | 10 months | ₹1,490 |

</section>


## Sources

Prices and market figures were checked on 2 Nov 2026 unless the entry gives its own date.

- **[S1]** India, about 13 million kirana stores: [Financial Express, Oct 2024](https://www.financialexpress.com/business/industry-rise-of-q-comm-shutters-2-lakh-kirana-stores-across-india-3651445/); [Economic Times, Jun 2025](https://economictimes.indiatimes.com/industry/cons-products/fmcg/fmcg-companies-roll-out-the-red-carpet-for-kiranas-amid-quick-commerce-boom/articleshow/122010436.cms); range of 12 to 15 million: [Policy Circle](https://www.policycircle.org/opinion/kirana-stores-online-retail/).
- **[S2]** China, about 7 million small shops: [Herbridge, citing Kantar retail data, Feb 2024](https://www.herbridge.com/news/28891j.html); about 6.3 million: [Jiemian](https://www.jiemian.com/article/7450537.html).
- **[S3]** SE Asia: [Liputan6, Indonesia 3.57 million warung (Euromonitor 2021)](https://www.liputan6.com/bisnis/read/5340012/jadi-penggerak-ekonomi-rakyat-indonesia-punya-357-juta-warung-tradisional); [Rest of World, Philippines 1.3 million](https://restofworld.org/2024/sari-sari-philippines-tech/); [Enterprise Singapore, Vietnam 1.4 million (2016)](https://www.enterprisesg.gov.sg/-/media/esg/files/overseas-markets/asia-pacific/vietnam/retail_market_entry_guide_vietnam.pdf?la=en); [C-ASEAN, Thailand about 400,000](https://www.c-asean.org/post/asean-s-mom-and-pop-stores-different-name-same-identity-and-its-function-to-drive-economies-forwa).
- **[S4]** India video surveillance: [Financial Express citing Counterpoint Research](https://www.financialexpress.com/business/industry-cctv-market-witnessing-local-shift-3902056/); [Mordor Intelligence via Research and Markets](https://www.researchandmarkets.com/reports/5996848/india-video-surveillance-market-share); [CP Plus filing summary (Frost & Sullivan)](https://ipocentral.in/cp-plus-ipo-financials-to-key-risks-10-things/).
- **[S5]** Retail analytics: [Fortune Business Insights](https://www.fortunebusinessinsights.com/industry-reports/retail-analytics-market-101273); [Global Market Insights](https://www.gminsights.com/industry-analysis/retail-analytics-market).
- **[S6]** Retail MSME digital habits (PayNearby MSME Digital Index 2024, 10,000+ retail MSMEs): [Entrepreneur India, 26 Jun 2024](https://india.entrepreneur.com/news-and-trends/whatsapp-and-whatsapp-business-dominate-msme-landscape-with/476232).
- **[S7]** Camera prices: [Smartprix, cameras under ₹2,000 (updated 2 Nov 2026)](https://www.smartprix.com/cctv_cameras/price-below_2000); [Gadgets 360, 22 Feb 2026](https://www.gadgets360.com/cameras/features/best-security-cctv-camera-under-rs-5000-smart-home-realme-trueview-cp-plus-imou-hikvision-tp-link-11112724).
- **[S8]** DPDP Act and CCTV: [MediaNama, 21 Nov 2025](https://www.medianama.com/2025/11/223-dpdp-act-citizens-cctv-surveillance/).

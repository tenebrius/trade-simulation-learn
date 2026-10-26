# Let Them Trade: economy model (reverse-engineered)

Source: static analysis of `LetThemTrade-Win64-Shipping.exe` (UE 5.5, CL 39378466, C++ game module).
Method: recovered Unreal reflection tables (class, struct, field and offset data), C++ constructor defaults, and Ghidra decompilation of selected functions. This document describes the mechanics in my own words; it does not reproduce game code.

Confidence tags:
- **[code]** read directly from decompiled logic
- **[defaults]** constant values recovered from C++ constructors; a cooked data asset may override them
- **[struct]** inferred from field names and types in the reflection data, with no formula confirmed yet

---

## 1. Actors

| Actor | Role | Key state |
|---|---|---|
| **Trade port** (`UTradePort`, one per city) | The city's single market interface. Holds storage and a cash bank, and quotes a buy price and a sell price per good. | `Storage[good]` (`FTradePortStorage`), `TradePortBank`, tax %, generosity setting |
| **City** | Producers (production buildings) and consumers (residents, castle, industry). City transporters move goods between buildings and the port. | Population, consumer slots, storage size 100, start budget 1,000 |
| **Trade guild** (`UTradeGuild`) | AI merchant companies. They open *branches* in ports, own *traders*, and pick *trade routes*. | Bank (account, reserve, emergency reserve), character (greed / precaution / competitiveness), branches, routes, subsidy |
| **Trader** (`UTraderComponent`) | A wagon owned by a guild that hauls goods from a port that sells to a port that buys. | Capacity, wear and maintenance resources, profit and utilization averaged over 30 s |
| **Economy subsystem** (`UEconomyManagementSubsystem`) | Global market: per-good global, mean and theoretical prices, market orders, transport orders, route revenues. | `GlobalResourceData[good]`, market value totals |
| **Pricing prediction** (`UPricingPrediction`) | Cost-of-production valuation over the recipe graph, giving the *theoretical* price. Not machine learning. | Default values, recipe dependencies and ratios, approximated values |

Goods never move between buildings and other cities directly. Everything goes through ports, and only traders move goods between ports.

## 2. Global price layer

For each good, `FGlobalResourceData` holds:
- `MeanMarketPrice`: the reference that port price bands are built around **[code]**
- `GlobalMarketPrice`: the slow-moving anchor that local prices are pulled toward **[code]**
- `TheoreticalMarketPrice`: the recipe-based cost of production **[struct]**
- volumes (offered, asked, reserved, in transit, in stock), supply and demand rates (theoretical maximum, optimal, current), and histories

Market totals are recomputed as the sum over goods of (stock + in transit) × price, separately for the mean, global and theoretical prices **[code]**.

The global layer runs as a fixed sequence of steps inside the economy subsystem's tick. The ones that matter here **[code]**:

1. **Mean price** = volume-weighted average of all open **buy** market orders for the good: Σ(amount × price per unit) / Σ amount. The value is only replaced when such orders exist.
2. **Market totals**: the current, global and theoretical market values are recomputed as above.
3. **Global price drift**, once per tick for each good:
   - `money_dev = (C − 2.0 × TotalGlobalMarketValue) / C`, where C is a global coin quantity read from the economy registry (most likely the coins in circulation) and 2.0 is `DesiredCashVolumeToGoodsValue`. The result is stored as `RelativeMoneyVolumeToMarketValueDeviation`.
   - `global += (mean − global) × 0.01 × dt`, with 0.01 = `MeanToGlobalPriceWeightPerSec`.
   - `global += (theoretical − global) × 0.002 × dt`, with 0.002 = `TheoreticalToGlobalPriceWeightPerSec`.
   - `global += min(0.05, good_volume / total_volume) × global × dt × 0.05 × money_dev`. Here 0.05 = `RelativeMoneyVolumeToMarketWeightPerSec` and `MinimumGoodVolumeWeightPercentage` acts as a *cap*. Too much money relative to goods inflates prices; too little deflates them; goods that make up more of the market react more.
   - Global floor is 0.1, and NaN is reset to 0.1.
   - Unless a per-good flag is set, the mean is then **overwritten with the new global**. Ports therefore price against a reference that moves only at these slow rates, which is what keeps the band-based controller in section 3 from feeding back on itself.

`MaxGlobalRelativePriceChangePerSec` (0.00033) is not used here. The port controller uses it as an absolute cap on each price step: that same registry quantity × 0.00033 × dt.

## 3. Port pricing: the core loop [code]

This runs once per economy tick (1 s) for each port and each good.

### 3.1 Stock evaluation

`DesiredAmount = MaxAmount × DesiredFillFraction`. The default fill fraction is 0.5; with auto-storage it ranges from 0.1 to 0.8 and changes by at most 0.1/s.

- Stock **below** target → the port **buys**. `BuyVolume = Desired − Current`, posted as a market order.
- Stock **above** target → the port **sells**. `SellVolume = Current − Desired`.

### 3.2 Price bands (around the mean price M)

| | Min | Max |
|---|---|---|
| Buy | (1 − 0.4 + 0.1) · M = **0.7 M** | (1 + 0.4 + 0.1) · M = **1.5 M**, never below the theoretical price |
| Sell | (1 − 0.4 − 0.1) · M = **0.5 M** | (1 + 0.4 − 0.1) · M = **1.3 M** |

The 0.4 is `MaxMarketPriceDeviationFraction`. The 0.1 is `RelativeBuySellIntervalShift`, which tilts buy prices above sell prices so that hauling is profitable on average.

Further rules:
- Construction materials have their max buy price multiplied by 10.
- If no consumer depends on a good, both bounds collapse to (global + mean) / 2.
- Critical prices come from the good's *local value*, meaning what it costs or is worth locally.

### 3.3 Priority: a PID controller plus bias terms

Each tick the port computes a set of additive parts (`FTradePortPidParts`). On the **buy side** they are:

| Part | Formula (as implemented) | Weight (default) |
|---|---|---|
| Proportional | `P · OpenBuyVolume / DesiredAmount` (missing fraction) | P = 0.2 |
| Integral | `I · ∫ missing-fraction history` | I = 0.005 |
| Expected trend (D1) | `−D1 · ExpectedTrend`: stock already rising, so ease off | D1 = 0.4 |
| Market value change (D2) | `−D2 · mean relative price-delta trend of the good` | D2 = 0 |
| Local to global | `−1.8 · (price − global) / global` | 1.8 |
| Remaining liquidity | `−0.8 · ExpectedRemainingLiquidityFactor` | 0.8 |
| Income vs spending | `−0.4 · IncomeToSpendingDisparityFactor` | 0.4 |
| Cheaper to buy than produce | `0.2 · max(0, (localValue − price)/localValue) · (1 − liquidity)` | 0.2 |
| Overpriced buy | `−0.4 · max(0, price − lowerCritical) …` scaled by the fill target | −0.4 |
| High priority | flat weight if fill is below the player's high-priority threshold | per good |
| Market share | `(−P −I −D) parts · 0.85 · (1 − competitor coverage) · turnover factor` | 0.85 |
| Generosity | rich cities (wealth share > onset 1.0) bias toward paying more | 1.2, money-saver factor 0.7 |
| New port bonus | `0.8 × remaining fraction of a 400 s window` | 0.8 |
| Uneven stock distribution | `−1.0 · (unevenness value)` | 1.0 |
| Subsidy | `+0.6` if the good is subsidised (and a looser rate cap of 4%/s) | 0.6 |

`priority = clamp(sum × BasePriorityFactor, 0.0001, 1)`

The **sell side** mirrors this. The signs flip where it makes sense (a rising stock means sell harder; being above the global price means cut the price). It adds:
- *Selling under production cost*: `−0.2 · max(0, (value − price)/price)`.
- *Resource can't be afforded* by others: +0.2.
- *Unused sell priority*: −0.1 when nothing is flowing.

The sell priority is clamped to [0, 1].

### 3.4 From priority to price

- Buy target = `MinBuy + (MaxBuy − MinBuy) · priority`. High priority means pay more.
- Sell target = `MaxSell − (MaxSell − MinSell) · priority`. High priority means sell cheaper.
- Price floor is 0.1.

The step toward the target is rate-limited:
- `maxStep = price × 1%/s × dt` (4%/s when subsidised), also capped by a global absolute limit.
- Urgency bonus: `min(0.5, 0.1 · sqrt(|target − price| / price))`, which widens the step for large gaps.
- Steps pass through a smoothing buffer over 6 s (`DeltaPriceSmoothTime`), then the price is clamped to the band.

New ports start at mean × (1 ± 0.2).

Players can override pricing manually; the price is then fixed (`ManualOverridePrice`).

### 3.5 Taxes

Tax = port tax % + per-good resource tax %, applied as a factor (1 + tax).
- Internal buy price = quoted price × (1 + tax): the port pays the trader the quoted price and pays the tax on top.
- Internal sell price = quoted price / (1 + tax).

Starting city tax is 10%; per-good tax starts at 0%. Tax goes to the player.

## 4. Port finances [struct + code]

`FTradePortBank` tracks cash, incoming and outgoing cash, buy and sell order volumes, "optimal" expenses and income per second (|price × expected trend| for each good), and cached rates.

These feed back into pricing through two factors:
- **Remaining liquidity**: cash ÷ spending rate, measured against a 300 s critical window.
- **Income vs spending disparity.**

So a port running out of money automatically lowers buy prices and sells harder.

## 5. Guilds and traders [struct + defaults], formulas still to be confirmed

Guild constants **[defaults]**:
- New guild costs 500; a new branch costs 200 (founding cost factor 2.0, gain bonus 10×, first founding 20×).
- At most 5 free guilds and 6 branches per port; branch lease 0.01 (port) or 0.1 (guild).
- A branch stores 5 units and buys when at least 40% of storage is free; critical utilization is 0.9.
- **A trade must earn at least 1 coin to be considered.** Traders are repriced every 10 s and may switch route every 30 s; a route is reviewed against a 180 s window.
- Money reserve = 60 s of expenses; trader capacity reserve factor 2.0.

Character traits greed, precaution and competitiveness (weights ±10) drive:
- the maximum cash change per second;
- the usable range;
- extra precaution when the balance is negative;
- a competition malus and an expansion bonus on profit weighting;
- a bonus or malus to the money reserve when hiring new traders.

Trader constants **[defaults]**: profit and utilization are averaged over 30 s, max profit deviation is 0.5, repair speed is 100, and wagons wear per second and consume maintenance resources.

Routes (`FTradeRouteRevenue` / `FTradeGuildTradeRoute`) track gross profit, investment, distance, volume, serving traders per guild, cheapest guild, and estimated additional profit per extra trader per second. This is the per-route marginal-value test used to decide whether to add a trader. Route coverage states: has unused potential, has unused potential for an existing trader, overcrowded, balanced.

## 6. City side [struct + defaults]

- Consumers: residents, castle, industry. Each has consumption per second with additive and multiplicative modifiers.
- Supply quality drives happiness and migration: up to 10%/s probability of moving in or out.
- Producers: `FProductionSpecs` gives seconds per cycle, inputs, outputs, coin output per cycle and boosters. Minimum input stock is 5, minimum output space is 10, with fill and empty times of 120 s.
- City transporters: 5 units each, speed 0.3, load time 0.5–3 s. Their queue priority weights wait time (1), city size (1) and storage fill (40).
- Construction materials get priority weight 0.8 and basic needs 0.4.

## 7. Engine extras

`onnxruntime.dll` and `DirectML.dll` belong to Unreal's stock NNE plugins (NNEDenoiser, which uses Intel OIDN models for rendering). No game code uses them, and the economy has no ML component.

## 8. Why it works well (design takeaways)

1. **One port per city.** All local supply and demand is aggregated into one storage with a target fill, so the price signal is clean.
2. **Priority, not price, is controlled.** The controller outputs a number in [0, 1] that is mapped into a band around a market reference. Prices cannot run away, and many heterogeneous signals (stock, cash, wealth, competition, cost) simply add together.
3. **Rate limits at every level.** Per good about 1%/s, global about 0.03%/s, with 6 s smoothing. The game feels alive without oscillating.
4. **Buy/sell band shift.** Buying prices sit about 0.2 × mean above selling prices on average, which guarantees a trader margin, while distance and wagon upkeep decide which routes actually pay.
5. **Cost-of-production anchor.** The theoretical price from the recipe graph keeps the global level tied to real production costs.
6. **Liquidity feedback.** Broke ports stop bidding, so money and goods circulate instead of pooling.

---

### Simulation
`ltt_sim.py` reimplements sections 2–4 faithfully. It uses simplified stand-ins for sections 5–6:
- greedy profit-per-minute route choice with the 1-coin minimum;
- guilds hire when profitable and fire when broke;
- residents bring a fixed coin income;
- migration based on satisfaction.

There are no bandits, knights, tiles, research or events. Run:

```
python ltt_sim.py --seconds 7200 --csv run.csv
```

# Let Them Trade: economy model (reverse-engineered)

Source: static analysis of `LetThemTrade-Win64-Shipping.exe` (UE 5.5, CL 39378466, C++ game module).
Method: recovered Unreal reflection tables (class, struct, field and offset data), C++ constructor defaults, and Ghidra decompilation of selected functions. The cooked content (IoStore `.utoc`/`.ucas`) was unpacked with retoc and every asset searched for Blueprint calls into the economy. This document describes the mechanics in my own words; it does not reproduce game code.

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
| **City buyer** (a `UTraderComponent` owned by a city) | The city's own wagons. They buy goods at other ports and bring them home. This is what carries trade in the shipped game (section 5.4). | 2 per city by default, plus research and card bonuses |
| **Trade guild** (`UTradeGuild`) | Merchant companies that open *branches* in ports and own traders. Fully implemented in native code, but nothing in the shipped game founds one in a new game (section 5.5). | Bank (account, reserve, emergency reserve), character (greed / precaution / competitiveness), branches, routes, subsidy |
| **Trader** (`UTraderComponent`) | A wagon that hauls goods from a port that sells to a port that buys. Its owner (`TraderAllegiance`) is a city or a guild. | Capacity, wear and maintenance resources, profit and utilization averaged over 30 s |
| **Economy subsystem** (`UEconomyManagementSubsystem`) | Global market: per-good global, mean and theoretical prices, market orders, transport orders, route revenues. | `GlobalResourceData[good]`, market value totals |
| **Pricing prediction** (`UPricingPrediction`) | Cost-of-production valuation over the recipe graph, giving the *theoretical* price. Not machine learning. | Default values, recipe dependencies and ratios, approximated values |

Goods never move between buildings and other cities directly. Everything goes through ports, and only traders move goods between ports.

## 2. Global price layer

For each good, `FGlobalResourceData` holds:
- `MeanMarketPrice`: the reference that port price bands are built around **[code]**
- `GlobalMarketPrice`: the slow-moving anchor that local prices are pulled toward **[code]**
- `TheoreticalMarketPrice`: the recipe-based cost of production, see 2.1 **[code]**
- volumes (offered, asked, reserved, in transit, in stock), supply and demand rates (theoretical maximum, optimal, current), and histories

Market totals are recomputed as the sum over goods of (stock + in transit) × price, separately for the mean, global and theoretical prices **[code]**.

The global layer runs as a fixed sequence of steps inside the economy subsystem's tick. The ones that matter here **[code]**:

1. **Mean price** = volume-weighted average of all open **buy** market orders for the good: Σ(amount × price per unit) / Σ amount. The value is only replaced when such orders exist.
2. **Market totals**: the current, global and theoretical market values are recomputed as above.
3. **Global price drift**, once per tick for each good:
   - `money_dev = (C − 2.0 × TotalGlobalMarketValue) / C`, where C is the total coin budget of all cities (the "cities" element of the subsystem's budget tree, under "root") and 2.0 is `DesiredCashVolumeToGoodsValue`. The result is stored as `RelativeMoneyVolumeToMarketValueDeviation`.
   - `global += (mean − global) × 0.01 × dt`, with 0.01 = `MeanToGlobalPriceWeightPerSec`.
   - `global += (theoretical − global) × 0.002 × dt`, with 0.002 = `TheoreticalToGlobalPriceWeightPerSec`.
   - `global += min(0.05, good_volume / total_volume) × global × dt × 0.05 × money_dev`. Here 0.05 = `RelativeMoneyVolumeToMarketWeightPerSec` and `MinimumGoodVolumeWeightPercentage` acts as a *cap*. Too much money relative to goods inflates prices; too little deflates them; goods that make up more of the market react more.
   - Global floor is 0.1, and NaN is reset to 0.1.
   - Unless a per-good flag is set, the mean is then **overwritten with the new global**. Ports therefore price against a reference that moves only at these slow rates, which is what keeps the band-based controller in section 3 from feeding back on itself.

`MaxGlobalRelativePriceChangePerSec` (0.00033) is not used here. The port controller uses it as an absolute cap on each price step: the cities' coin total C × 0.00033 × dt.

### 2.1 Theoretical price: labour-seeded cost of production [code]

`UPricingPrediction` values every good from its recipe:

  value(good) = (ConstantCost + Σ input amount × value(input)) / output amount

The recipe graph bottoms out in **inhabitants** (`inhabitant_lvl_1` … `inhabitant_lvl_4`): labour is the only base input. All four levels are valued at one number, `TheoreticalMarketSeedValue`. Goods marked as *held* keep a fixed value. A NaN or non-positive result falls back to 0.01.

The solver runs up to 10 passes per update. In each pass a value may change by at most 1% of its previous value. It stops early once every relative change is below 0.1%. So theoretical prices follow the recipes smoothly rather than jumping.

**The seed is a money-supply controller.** Each economy tick:
- error = C − 2.0 × `TotalTheoreticalMarketValue`, with C the cities' coin total from above.
- The step `CachedTheoreticalMarketSeedDeltaValue` is multiplied by 1.1 while the error has the same sign as the step. When the sign differs it is multiplied by −0.9, which reverses it.
- seed += step, with a floor of 0.01.

This is a sign-based adaptive step, similar to Rprop. When cities hold more coins than twice the theoretical value of all goods, labour becomes worth more. That raises every theoretical price, which then pulls the global prices up at 0.002/s. Coin creation by residents (section 6) therefore turns into price inflation through two separate channels: the money_dev term above, and this seed.

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

## 5. Traders, city buyers and guilds

### 5.1 Orders: how goods get matched [code + struct]
Ports don't talk to traders directly. Each port posts **market orders** (`FMarketOrder`: good, amount, price per unit, buy or sell) with the economy subsystem. Volumes come from section 3.1 and prices from section 3.4. A **transport order** (`FTransportOrder`) pairs a source port's sell order with a target port's buy order. It records the amount, the sell price per unit (what the trader pays), the buy price per unit (what the trader receives) and the profit per unit. **[code]**: profit per unit = the target's buy price − the source's sell price, and the amount = the smaller of the two orders' remaining amounts (each order's amount minus what is already reserved or in transit). When a trader commits to a load it reserves the orders as a `FTransportContract`, which also records taxes and subsidies for both ends.

### 5.2 Route choice [code]
- **Filling the wagon**: to value a candidate route, the trader greedily fills its capacity from that route's transport orders. At each step it takes the order with the largest min(order amount, remaining capacity) × profit per unit, then repeats with the remaining capacity. Wagons therefore carry **mixed goods**. Port subsidies are added to the value, capped by what the port can still pay out.
- **Noisy switching**: a candidate replaces the current choice only if it beats the best so far **and** beats the baseline × (1 + s · 0.5 · r²). Here r is a fresh random number in [−1, 1], s is its sign, and 0.5 is `MaxProfitDeviationFraction`. Most draws are close to 1, but now and then a trader demands up to 50% more, or accepts up to 50% less. This spreads traders across routes instead of letting them all herd onto the single best one.
- **Utilization** = loaded amount ÷ capacity, stored as `CurrentTraderUtilizationFraction` and fed into the guild's route statistics.

### 5.3 Trader cash [code]
Each trader carries its own cash (`TraderStats.Budget`). If the planned purchase costs more than the budget, the trader asks its owner for the gap. If that's refused it asks for half, then for a quarter. A guild approves a request only if **account − emergency reserve > requested amount**; the cash then moves from the guild bank into the trader's budget. A city buyer sends the same requests to its home port instead, which grants one whenever **amount ≤ the port's `BankAmount`**. There is no reserve, so a city can lend its whole bank. The port also tracks the cash out with its wagons as `CashDistributedToTraders`. **After every delivery a trader hands all its cash back to its owner**, meaning its budget plus the proceeds, so no money stays with a wagon between trips. A city buyer flagged to return home first does so on arrival. The trader tick is a state machine over `ETraderTask`: move to route, trading, collect maintenance resources, maintenance, resupply, move to scrap, scrap.

### 5.4 City buyers: how trade actually happens [code]

Every city spawns its own traders when it is set up. The castle keep does the same with `InitialCityBuyers`. The target count is `NumCityBuyers` (**2**) plus any research or card bonuses. When the target changes, the city spawns or removes the difference. Each buyer is a normal `UTraderComponent` whose allegiance is the city, flagged as *city-owned*. It uses the same machinery as any trader (sections 5.1–5.3), with these differences:
- **Routes:** a buyer serves every trade route that has its home port at one end. The list is rebuilt each time it re-plans.
- **Direction:** each route is valued in both directions, but a buyer **never loads at its home port**. It only fetches goods from other ports and delivers them home.
- **Value:** the same as for any trader. The greedy wagon fill gives the profit, minus (path length + extra) × transport cost.
- **Money:** the buyer borrows the purchase cost from its home port's bank (granted if the bank covers it) and returns everything after delivering. The contract records `TraderOwner` = Target, meaning the trader belongs to the receiving port. The home city therefore pays the source city's sell price plus taxes, while the buy-minus-sell margin stays inside the city.
- **Statistics:** utilization is averaged over `CityBuyerIntegrationTime` (60 s).

So in the shipped game, imports are pulled by the buying city, which pays for its own hauling. Exports happen only because other cities' buyers come and collect them.

### 5.5 Guild life cycle (present in code, dormant in the shipped game)

**What native code does [code]:**
- **Founding a guild.** The founding function refuses once `MaxSimultaneousFreeTradeGuilds` (5) guilds exist. The new guild's opening account is funded either by the port it starts in (from the port's cash) or from a caller-supplied amount, capped by what the payer holds. Starting a guild also restarts the association's founding cooldown (`GuildFoundingTimer += GuildFoundingTimeOut`). Character traits come from the guild's style, or are four independent uniform random numbers in [0, 1] when the style has none.
- **Can the guild afford a branch?** Three conditions must hold: the branch cooldown is exactly 0, the guild's trader type has a known price, and **wagon price + `DefaultBranchLease` x `IncludedFoundingLeaseTime` < account - money reserve**. With defaults that is wagon price + 0.1 x 120.
- **Opening a branch.** The port rejects the branch once it holds `MaxNumTradeGuildBranches` (6) branches. It then takes a market slot and settles the lease credit, either from its own funds or from the credit passed in. The branch registers with its guild, which **adds `FoundNewBranchTimeOut` (60 s) to the branch cooldown** and immediately **spawns one trader**. That trader is assigned to the guild route through this port with the highest *total gross profit*.
- **Leases.** Every tick a branch owes the port lease x dt. It pays from its prepaid `BranchCredit` first, then from the guild account. When paid in full, the cost is booked against the branch's routes in equal shares, as negative transfers in route accounting.
- **Firing traders.** Scrapping is triggered in only one way: the guild cannot pay a lease. The guild then walks its traders and pulls each one's whole cash budget back into the account until the shortfall is covered. **Every trader drained this way is scrapped.** One with a home branch drives there first (`MoveToScrap`), returns any cash, then is removed. Profit-based culling does not exist anywhere in native code.
- **Bankruptcy.** If the lease still can't be paid after recalling trader cash, the guild dissolves. All traders are scrapped, all branches closed, and any remaining account goes to the **player's** budget. The guild is removed, and the founding cooldown resets to `GuildFoundingTimeOut`, or to 10% of it when no guild is left.
- **Reassignment.** When routes change, a guild re-assigns traders to its highest-gross-profit route.
- **Trader cash requests** (5.3): granted only if account - emergency reserve > amount.

**Who triggers founding and expansion: nobody [code]:**
- A guild object is created in exactly two places: when a save game is loaded, and inside `TryFoundTradeGuildInTargetPort`. A branch is created only on load and inside the port's `TryOpenTradeGuildBranch`.
- These functions, `GuildCanAffordNewBranch` and `TrySpawnTraderForTradeGuildBranch` are reachable only through their reflection thunks. No native code calls them. No cooked asset references them: all 4,461 packages were unpacked and searched. Nothing calls them by name either: each name string is referenced only by the reflection tables, with no wide-string literal for a dynamic delegate.
- The guild-spawning and branch-founding widgets (`USpawnTradeGuildMainWidget`, `UCardFoundNewTradeGuildBranchWidget`) exist as native classes, but no shipped Blueprint uses them. The shipped config sets `Feature_Cheats=False`.
- The cooldowns never count down: native code only adds to `FoundNewBranchTimer` and `GuildFoundingTimer` and checks them. A guild that has opened one branch could therefore never pass the affordability check again.
- Character traits are set at founding but never read by native arithmetic. `EstimatedAdditionalProfitPerTraderPerSec` on routes is never written.

Conclusion: the guild layer is complete but **dormant** in this build. Guilds appear only from save games, presumably older ones, since the config has `RepairOldSaveGames=True`, or through developer tools. City buyers (5.4) do the trading. `FCityConstants` still carries `CityTradeGuildStyle` and `SupplyCityTradeGuildTime` (10 s), which look like a bridge between the two designs. I found no native code reading them **[struct]**.

Guild constants **[defaults]**:
- New guild costs 500; a branch costs 200 (founding cost factor 2.0, gain bonus 10x, first founding 20x).
- At most 5 free guilds and 6 branches per port. Branch lease is 0.01 (port setting) or 0.1 (guild setting), with 120 s of lease included on founding.
- Branch cooldown 60 s. A branch stores 5 units and buys when at least 40% of storage is free; critical utilization 0.9.
- **A trade must earn at least 1 coin to be considered.** Traders are repriced every 10 s and may switch route every 30 s; a route is reviewed against a 180 s window.
- Money reserve time 60 s; trader capacity reserve factor 2.0.

Trader constants **[defaults]**: profit and utilization are averaged over 30 s, max profit deviation is 0.5, repair speed is 100, and wagons wear per second and consume maintenance resources. `ETraderTask` values: Trading 0, MoveToTradeRoute 1, MoveToMaintenance 2, CollectingMaintenanceResources 3, Maintenance 4, MoveToResupply 5, Resupply 6, MoveToScrap 7, ScrapTrader 8.

## 6. City side

### 6.1 Production [code]
Each production building's tick:
- **Productivity** = filled worker slots / worker slots. It is 1 when the building needs no workers and 0, blocked, when no slot is filled.
- A cycle **starts** when it isn't blocked by missing inputs. Inputs are deducted **at the start** and progress resets to 0.
- **Progress** += dt / `SecondsPerCycle` x productivity. At 1.0 the cycle finishes, delivering outputs if there is room, and the next one tries to start immediately.
- Each input slot orders a refill from the city whenever it has whole units of free capacity.
- `FProductionSpecs` also defines coin output per cycle and boosters **[struct]**. Defaults: minimum input stock 5, minimum output space 10, fill and empty times 120 s **[defaults]**.

### 6.2 Residents: consumption, happiness, income, migration [code]
Housing tiles (`UResidentialTileComponent`) run these steps every economy tick, in this order:
1. **Restock**: a consumer slot orders from the city when its free capacity (whole units) is more than `MinFreeConsumerCapacityFractionToOrder` (5%) of capacity.
2. **Migration**: see below.
3. **Consumption**: each consumer slot draws `ConsumePerSecond` x dt from its local stock. *Satisfaction* = the share of that draw actually available: 1 if fully met, stock / need if partly met, 0 if empty.
4. **Happiness**: each resident has a target built from their type's base happiness, plus the building's bonus, plus job or unemployment happiness. Each consumed good then adds satisfaction x `SupplyHappiness` when that is non-zero, or else (1 - satisfaction) x `UndersupplyHappiness` (a penalty). The target is clamped to [0, 1]. Happiness moves toward it by at most dt x `MaxRelativeHappinessChangeSpeed` (0.01) x max(|gap|, 0.1) per tick. The house's average happiness is the mean over its residents.
5. **Income**: every `ResidenceCoinPayInterval`, each resident pays interval x (`BasePaymentPerSec` + f x `MaxBonusPaymentPerSec`) into the city. Here f = max(0, (avg - critical) / (1 - critical)). A multiplicative building bonus applies. Both payments default to 1.0/s per inhabitant in C++. **Residents are the source of new coins**, and that is what drives the money terms in section 2.

**Migration**: let occupancy f = residents / slots and h = clamp(avg happiness / critical happiness, 0, 1).
- If h >= f: rate = (h - f) / (1 - f) x `MaxMoveInProbabilityPerSec`. Each empty slot rolls in turn; it is filled when a uniform random number exceeds (1 - rate)^dt. At most one person moves in per tick.
- Otherwise, recompute h using max(target, average) happiness. If that is still below f: rate = (f - h) / f x `MaxMoveInProbabilityPerSec`, and occupied slots roll in the same way for at most one move-out per tick.
- Quirk: both directions use **MaxMoveIn**. `MaxMoveOutProbabilityPerSec` is not read by this code.

### 6.3 Logistics [defaults]
Each city has 3 transporters (`NumCityTransporters`), each carrying up to 5 different goods and 5 units at speed 0.3, with load times of 0.5-3 s and up to 6 s idle. Their queue priority weights wait time (1), city size (1) and storage fill (40). Construction materials get priority weight 0.8 and basic needs 0.4.

## 7. Engine extras

`onnxruntime.dll` and `DirectML.dll` belong to Unreal's stock NNE plugins (NNEDenoiser, which uses Intel OIDN models for rendering). No game code uses them, and the economy has no ML component.

## 8. Why it works well (design takeaways)

1. **One port per city.** All local supply and demand is aggregated into one storage with a target fill, so the price signal is clean.
2. **Priority, not price, is controlled.** The controller outputs a number in [0, 1] that is mapped into a band around a market reference. Prices cannot run away, and many heterogeneous signals (stock, cash, wealth, competition, cost) simply add together.
3. **Rate limits at every level.** Per good about 1%/s, global about 0.03%/s, with 6 s smoothing. The game feels alive without oscillating.
4. **Buy/sell band shift.** Buying prices sit about 0.2 × mean above selling prices on average, which guarantees a trader margin, while distance and wagon upkeep decide which routes actually pay.
5. **Cost-of-production anchor.** The theoretical price from the recipe graph keeps the global level tied to real production costs.
6. **Liquidity feedback.** Broke ports stop bidding, so money and goods circulate instead of pooling.
7. **Labour is the unit of value.** Residents create the coins, and the theoretical price of every good is a recipe-weighted amount of labour priced by one seed that tracks the coins in circulation. Inflation therefore follows population and happiness instead of being scripted.
8. **Demand pulls the goods.** Trade is driven by the buyer: each city's own wagons go out to fetch what its port bids for and pay for the trip from city funds. There is no separate merchant class to keep solvent. Every city with demand and cash generates trade, and a broke city stops importing (takeaway 6).
9. **(Dormant guilds) Cash flow, not bad routes, kills a guild.** In the guild layer, a guild only loses traders when it can't pay its branch leases. Unprofitable traders keep running until the money runs out, then get recalled one by one; if that isn't enough, the whole guild goes bankrupt.

---

### Simulation
`ltt_sim.py` reimplements sections 2 (including the labour-seeded theoretical prices), 3, 4, 5.1–5.4 and 6.1–6.2 (production, consumption, happiness, income, migration). Each city starts with 2 city buyers, which import goods from the other cities to their home port. The dormant guild layer (5.5) is available with `--guilds`. In that mode, founding and branch decisions, which have no trigger in the shipped game, use simple stand-in rules: a guild opens a branch whenever it can afford one, and the richest port founds a new guild after the cooldown. Other simplifications:
- Transport orders are built on the fly from port surpluses and shortfalls.
- The guild's emergency reserve, the critical happiness (0.5), the pay interval (10 s) and the happiness weights are sim choices. Resident pay is scaled down to the sim's price level.
- There is no player, so coins only enter through resident pay. Prices therefore inflate slowly through both money terms, as section 2 predicts.

There are no bandits, knights, tiles, research or events. Run:

```
python ltt_sim.py --seconds 7200 --csv run.csv
python ltt_sim.py --seconds 7200 --guilds
```

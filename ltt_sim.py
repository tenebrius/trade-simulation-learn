"""
Minimal trade-economy simulation modelled on the mechanics recovered from
Let Them Trade (see economy_model.md). Original implementation, no game code.

Fixed set of cities. Each city has:
  - a trade port (storage per good, cash bank, buy/sell prices per good)
  - production buildings (recipes) that pull inputs from / push outputs to the port
  - residents that consume goods; population drifts with supply satisfaction
Guilds own traders that haul goods between ports along the most profitable route.

Run:  python ltt_sim.py [--seconds 3600] [--seed 1] [--csv out.csv]
"""
import argparse
import csv
import math
import random
from dataclasses import dataclass, field

# ---------------------------------------------------------------- constants
# Defaults recovered from the game's C++ constructors (FTradePortConstants, etc.)
TICK = 1.0                      # EconomyTickInterval
STORAGE_SIZE = 100              # CityConstants.StorageSize
DESIRED_FILL = 0.5              # DefaultDesiredStorageFraction
MAX_DEV = 0.4                   # MaxMarketPriceDeviationFraction
BUY_SELL_SHIFT = 0.1            # RelativeBuySellIntervalShift
START_DEV = 0.2                 # StartPriceDeviation
P_W, D1_W, I_W = 0.2, 0.4, 0.005
INC_SPEND_W = 0.4               # IncomeToSpendingDisparityWeight
REM_LIQ_W = 0.8                 # RemainingLiquidityTimeWeight
CRIT_LIQ_TIME = 300.0           # CriticalRemainingLiquidityTime
SELL_UNDER_W = -0.2             # SellUnderValueWeight
CHEAPER_BUY_W = 0.2             # CheaperBuyThanProduceLocalWeight
OVERPRICED_BUY_F = -0.4         # OverpricedBuyFactor
L2G_W = 1.8                     # LocalToGlobalMarketValueDeviationWeight
MAX_GOOD_REL_CHG = 0.01         # MaxGoodRelativePriceChangePerSec
MAX_URGENCY = 0.5               # MaxUrgencyPriceChangeBonus
SMOOTH_TIME = 6.0               # DeltaPriceSmoothTime
NEW_PORT_BONUS_T, NEW_PORT_BONUS_W = 400.0, 0.8
MIN_PRICE = 0.1
STOCK_INTEGRATION = 300.0       # StockDataIntegrationTime
MEAN_TO_GLOBAL_W = 0.01         # EconomyConstants.MeanToGlobalPriceWeightPerSec
THEO_TO_GLOBAL_W = 0.002        # EconomyConstants.TheoreticalToGlobalPriceWeightPerSec
MAX_GLOBAL_REL_CHG = 0.00033    # MaxGlobalRelativePriceChangePerSec
REL_MONEY_W = 0.05              # EconomyConstants.RelativeMoneyVolumeToMarketWeightPerSec
DESIRED_CASH_TO_GOODS = 2.0     # EconomyConstants.DesiredCashVolumeToGoodsValue
MIN_GOOD_VOLUME_W = 0.05        # EconomyConstants.MinimumGoodVolumeWeightPercentage (used as a cap)
RESIDENT_INCOME = 0.05          # (simplification) coins per resident per second paid into the city
CITY_TAX = 0.10                 # EconomyConstants.StartCityTax (%)
CITY_START_BUDGET = 1000.0
MIN_PROFIT = 1.0                # TradeGuild.DefaultMinProfitToConsiderTrade
MONEY_RESERVE_TIME = 60.0       # TradeGuild.MoneyReserveTime
ROUTE_SWITCH_TIMEOUT = 30.0     # TradeGuild.TraderRouteSwitchTimeOut
NEW_TRADER_COST = 200.0         # ~SpawnGuildBranchDefaultCost, reused as trader price
MAX_PROFIT_DEV = 0.5            # TraderConstants.MaxProfitDeviationFraction
GUILD_EMERGENCY_RESERVE = 100.0 # (simplification) guild never lends below this
TRADER_BUDGET_KEEP = 150.0      # (simplification) cash a trader keeps after a trip
TRADER_CAPACITY = 10
TRADER_SPEED = 1.0              # distance units / second
MOVE_PROB = 0.1                 # Max move in/out probability per sec (scaled down below)

# ---------------------------------------------------------------- world data
GOODS = {  # base value used to seed theoretical prices for raw goods
    "grain": 4.0, "wood": 5.0, "fish": 6.0,
    "flour": None, "bread": None, "tools": None,
}
RECIPES = {  # output: (inputs{good: qty}, out_qty, seconds_per_cycle)
    "grain": ({}, 2, 10.0),
    "wood": ({}, 2, 10.0),
    "fish": ({}, 1, 8.0),
    "flour": ({"grain": 2}, 2, 10.0),
    "bread": ({"flour": 2}, 3, 12.0),
    "tools": ({"wood": 3}, 1, 15.0),
}
NEEDS = {"bread": 0.0025, "fish": 0.0015, "tools": 0.0004}  # per resident per second

CITY_SETUP = [  # name, (x, y), population, buildings
    ("Ashford", (0, 0), 60, ["grain", "grain", "flour", "bread"]),
    ("Brindle", (40, 10), 50, ["wood", "wood", "tools", "fish"]),
    ("Corran", (15, 45), 45, ["fish", "fish", "grain", "flour"]),
    ("Dunmere", (55, 50), 55, ["wood", "bread", "tools"]),
]
GUILDS = [("Red Hand", 3), ("Silver Wheel", 3)]


def theoretical_values():
    """Cost-of-production valuation over the recipe graph (PricingPrediction)."""
    val = {g: v for g, v in GOODS.items() if v is not None}
    for _ in range(len(GOODS)):
        for good, (inputs, out_qty, _) in RECIPES.items():
            if good in val or not all(i in val for i in inputs):
                continue
            val[good] = 1.25 * sum(val[i] * q for i, q in inputs.items()) / out_qty
    return val


# ---------------------------------------------------------------- model
@dataclass
class Storage:
    good: str
    amount: int = 0
    max_amount: int = STORAGE_SIZE
    desired_fill: float = DESIRED_FILL
    buy_price: float = -1.0
    sell_price: float = -1.0
    trend: float = 0.0            # measured net inflow per sec (smoothed)
    integral: float = 0.0         # integrated relative discrepancy
    price_delta_smooth: float = 0.0
    priority: float = 0.0
    flow_acc: float = 0.0         # net units moved this tick
    local_value: float = 0.0      # what local producers would pay / it costs to make here

    @property
    def desired(self):
        return int(self.max_amount * self.desired_fill)


@dataclass
class Building:
    output: str
    progress: float = 0.0
    running: bool = False


@dataclass
class City:
    name: str
    pos: tuple
    population: float
    buildings: list
    cash: float = CITY_START_BUDGET
    tax_income: float = 0.0
    storage: dict = field(default_factory=dict)
    income_rate: float = 0.0
    spend_rate: float = 0.0
    new_port_timer: float = NEW_PORT_BONUS_T
    satisfaction: float = 1.0
    consume_acc: dict = field(default_factory=dict)

    def dist(self, other):
        return math.dist(self.pos, other.pos)


@dataclass
class Trader:
    guild: "Guild"
    city: City
    task: str = "idle"           # idle | to_source | to_dest
    route: tuple = None          # (src, dst, [(good, qty), ...])
    route_value: float = 0.0     # profit/min of the route currently followed
    cargo: list = field(default_factory=list)   # [(good, qty, paid_per_unit)]
    budget: float = 0.0          # trader's own cash (FTraderStats.Budget)
    eta: float = 0.0
    switch_timer: float = 0.0
    profit_avg: float = 0.0


@dataclass
class Guild:
    name: str
    cash: float = 600.0
    traders: list = field(default_factory=list)
    earned: float = 0.0


class Economy:
    def __init__(self, seed=1):
        self.rng = random.Random(seed)
        self.t = 0.0
        self.theo = theoretical_values()
        self.mean = dict(self.theo)          # MeanMarketPrice
        self.glob = dict(self.theo)          # GlobalMarketPrice
        self.cities = []
        for name, pos, pop, bld in CITY_SETUP:
            c = City(name, pos, pop, [Building(b) for b in bld])
            for g in GOODS:
                c.storage[g] = Storage(g, amount=self.rng.randint(10, 40))
                c.consume_acc[g] = 0.0
            self.cities.append(c)
        self.guilds = []
        for gname, n in GUILDS:
            gd = Guild(gname)
            for i in range(n):
                gd.traders.append(Trader(gd, self.cities[i % len(self.cities)]))
            self.guilds.append(gd)
        self.log = []

    # ---------------------------------------------------------- production
    def produce_and_consume(self, dt):
        for c in self.cities:
            for b in c.buildings:
                inputs, out_qty, secs = RECIPES[b.output]
                st_out = c.storage[b.output]
                if not b.running:
                    if all(c.storage[i].amount >= q for i, q in inputs.items()) and \
                            st_out.amount + out_qty <= st_out.max_amount:
                        for i, q in inputs.items():
                            c.storage[i].amount -= q
                            c.storage[i].flow_acc -= q
                        b.running, b.progress = True, 0.0
                if b.running:
                    b.progress += dt
                    if b.progress >= secs:
                        st_out.amount = min(st_out.max_amount, st_out.amount + out_qty)
                        st_out.flow_acc += out_qty
                        b.running = False
            # residents
            got, want = 0, 0
            for g, rate in NEEDS.items():
                c.consume_acc[g] += rate * c.population * dt
                n = int(c.consume_acc[g])
                if n:
                    take = min(n, c.storage[g].amount)
                    c.storage[g].amount -= take
                    c.storage[g].flow_acc -= take
                    c.consume_acc[g] -= n
                    got, want = got + take, want + n
            c.cash += RESIDENT_INCOME * c.population * dt
            c.income_rate += RESIDENT_INCOME * c.population * dt
            if want:
                c.satisfaction += (got / want - c.satisfaction) * min(1.0, want * 0.05)
            # population: move in when supplied, out when not (scaled MaxMove probs)
            if self.rng.random() < MOVE_PROB * dt * max(0.0, c.satisfaction - 0.8) * 0.5:
                c.population += 1
            if self.rng.random() < MOVE_PROB * dt * max(0.0, 0.6 - c.satisfaction) * 0.5:
                c.population = max(5, c.population - 1)

    def local_values(self):
        """Local value of a good: what it is worth to this city's producers/consumers."""
        for c in self.cities:
            made_here = {b.output for b in c.buildings}
            for g, st in c.storage.items():
                v = self.theo[g]
                if g in made_here:
                    inputs, out_qty, _ = RECIPES[g]
                    v = sum(c.storage[i].buy_price if c.storage[i].buy_price > 0 else self.glob[i]
                            for i, q in inputs.items() for _ in range(q)) / out_qty if inputs else v * 0.8
                st.local_value = max(MIN_PRICE, v)

    # ---------------------------------------------------------- pricing
    def price_ports(self, dt):
        for c in self.cities:
            if c.new_port_timer > 0:
                c.new_port_timer -= dt
            new_bonus = max(0.0, c.new_port_timer / NEW_PORT_BONUS_T) * NEW_PORT_BONUS_W
            liquidity_time = c.cash / max(c.spend_rate, 1e-3)
            liq_factor = max(0.0, min(1.0, 1.0 - liquidity_time / CRIT_LIQ_TIME))
            disparity = (c.spend_rate - c.income_rate) / max(c.spend_rate + c.income_rate, 1e-3)
            for g, st in c.storage.items():
                k = dt / STOCK_INTEGRATION
                st.trend += (st.flow_acc / dt - st.trend) * min(1.0, k * 10)
                st.flow_acc = 0
                mean, glob = self.mean[g], self.glob[g]
                # price bands around the global mean
                buy_lo, buy_hi = (1 - MAX_DEV + BUY_SELL_SHIFT) * mean, max(
                    (1 + MAX_DEV + BUY_SELL_SHIFT) * mean, self.theo[g])
                sell_lo, sell_hi = (1 - MAX_DEV - BUY_SELL_SHIFT) * mean, (1 + MAX_DEV - BUY_SELL_SHIFT) * mean
                if st.buy_price < 0:
                    st.buy_price = (1 + START_DEV) * mean
                    st.sell_price = (1 - START_DEV) * mean
                missing = st.desired - st.amount
                if missing > 0:      # ---- buying side
                    rel = missing / max(st.desired, 1)
                    # windowed sum of the discrepancy over the last ~STOCK_INTEGRATION seconds
                    st.integral = st.integral * (1 - dt / STOCK_INTEGRATION) + rel * dt
                    terms = [
                        P_W * rel,                                   # proportional
                        -D1_W * st.trend,                            # stock already rising -> relax
                        I_W * st.integral,                           # accumulated shortage
                        -L2G_W * (st.buy_price - glob) / glob,       # pull to global price
                        -REM_LIQ_W * liq_factor,                     # running out of cash
                        -INC_SPEND_W * max(0.0, disparity),          # spending > income
                        CHEAPER_BUY_W * max(0.0, (st.local_value - st.buy_price) / st.local_value)
                        * (1 - liq_factor),
                        OVERPRICED_BUY_F * max(0.0, st.buy_price - st.local_value) / max(mean, 1e-3),
                        new_bonus,
                    ]
                    prio = max(1e-4, min(1.0, sum(terms)))
                    target = buy_lo + (buy_hi - buy_lo) * prio
                    st.buy_price = self._slew(st, st.buy_price, target, dt, buy_lo, buy_hi)
                    st.sell_price = max(st.sell_price, st.buy_price * 1.05)  # not selling
                else:                # ---- selling side
                    surplus = -missing
                    rel = surplus / max(st.max_amount - st.desired, 1)
                    st.integral = st.integral * (1 - dt / STOCK_INTEGRATION)
                    terms = [
                        P_W * rel,
                        D1_W * st.trend,                             # stock still rising -> sell harder
                        L2G_W * (st.sell_price - glob) / glob,       # above global -> cut price
                        -REM_LIQ_W * liq_factor * -1,                # need cash -> sell harder
                        SELL_UNDER_W * max(0.0, st.local_value - st.sell_price) / max(st.sell_price, 0.1),
                        new_bonus,
                    ]
                    prio = max(0.0, min(1.0, sum(terms)))
                    target = sell_hi - (sell_hi - sell_lo) * prio
                    st.sell_price = self._slew(st, st.sell_price, target, dt, sell_lo, sell_hi)
                    st.buy_price = min(st.buy_price, st.sell_price * 0.95)  # not buying
                st.priority = prio

    def _slew(self, st, price, target, dt, lo, hi):
        target = max(target, MIN_PRICE)
        delta = target - price
        urgency = min(MAX_URGENCY, 0.1 * math.sqrt(abs(delta / max(price, 1e-3))))
        step_cap = price * MAX_GOOD_REL_CHG * dt * (1 + urgency)
        step = max(-step_cap, min(step_cap, delta))
        st.price_delta_smooth += (step - st.price_delta_smooth) * min(1.0, dt / SMOOTH_TIME)
        return max(lo, min(hi, price + st.price_delta_smooth))

    def update_global_prices(self, dt):
        # Mean = volume-weighted average of open buy-order prices (ports below target).
        # Global drifts toward mean and theoretical value, plus a money-supply term:
        # too much cash relative to DESIRED_CASH_TO_GOODS x goods value inflates prices.
        volume = {g: sum(c.storage[g].amount for c in self.cities) for g in GOODS}
        total_volume = sum(volume.values())
        goods_value = sum(volume[g] * self.glob[g] for g in GOODS)
        cash = sum(c.cash for c in self.cities) + sum(gd.cash for gd in self.guilds)
        money_dev = (cash - DESIRED_CASH_TO_GOODS * goods_value) / cash if cash > 0 else 0.0
        self.money_dev = money_dev
        for g in GOODS:
            orders = [(c.storage[g].desired - c.storage[g].amount, c.storage[g].buy_price)
                      for c in self.cities if c.storage[g].amount < c.storage[g].desired]
            vol = sum(a for a, _ in orders)
            if vol > 0:
                self.mean[g] = sum(a * p for a, p in orders) / vol
            glob = self.glob[g]
            glob += (self.mean[g] - glob) * MEAN_TO_GLOBAL_W * dt
            glob += (self.theo[g] - glob) * THEO_TO_GLOBAL_W * dt
            if total_volume > 0:
                share = min(MIN_GOOD_VOLUME_W, volume[g] / total_volume)
                glob += share * glob * dt * REL_MONEY_W * money_dev
            self.glob[g] = max(MIN_PRICE, glob)
            self.mean[g] = self.glob[g]   # game re-syncs the reference to global each tick

    # ---------------------------------------------------------- traders
    def transport_orders(self, src, dst):
        """Pair src sell orders with dst buy orders: [(good, amount, sell_ppu, buy_ppu)]."""
        orders = []
        for g in GOODS:
            s, d = src.storage[g], dst.storage[g]
            amount = min(s.amount - s.desired, d.desired - d.amount)
            if amount > 0 and d.buy_price > s.sell_price:
                orders.append((g, amount, s.sell_price, d.buy_price))
        return orders

    @staticmethod
    def fill_wagon(orders, capacity):
        """Greedy fill: repeatedly take the order with the largest qty x profit-per-unit."""
        load, profit, cost = [], 0.0, 0.0
        left = list(orders)
        while capacity > 0 and left:
            best = max(left, key=lambda o: min(o[1], capacity) * (o[3] - o[2]))
            g, amount, sell, buy = best
            qty = min(amount, capacity)
            load.append((g, qty))
            profit += qty * (buy - sell)
            cost += qty * sell
            capacity -= qty
            left.remove(best)
        return load, profit, cost

    def plan_route(self, tr):
        """Return (src, dst, load, value). Options must beat the current route by a noisy margin."""
        r = self.rng.uniform(-1.0, 1.0)
        noise = 1.0 + math.copysign(1.0, r) * MAX_PROFIT_DEV * r * r
        best, best_value = None, max(MIN_PROFIT, tr.route_value)
        baseline = tr.route_value
        for src in self.cities:
            for dst in self.cities:
                if src is dst:
                    continue
                load, profit, _ = self.fill_wagon(self.transport_orders(src, dst), TRADER_CAPACITY)
                if profit < MIN_PROFIT:
                    continue
                t = (tr.city.dist(src) + src.dist(dst)) / TRADER_SPEED + 4
                value = profit / t * 60   # profit per minute
                if value > best_value and value > noise * baseline:
                    best, best_value = (src, dst, load, value), value
        return best

    def request_budget(self, tr, amount):
        """Trader asks its guild for cash: full gap, then half, then a quarter."""
        gd = tr.guild
        for part in (amount, amount * 0.5, amount * 0.25):
            if part < gd.cash - GUILD_EMERGENCY_RESERVE:
                gd.cash -= part
                tr.budget += part
                return True
        return False

    def run_traders(self, dt):
        for gd in self.guilds:
            for tr in gd.traders:
                if tr.task == "idle":
                    tr.switch_timer -= dt
                    if tr.switch_timer > 0:
                        continue
                    tr.switch_timer = ROUTE_SWITCH_TIMEOUT / 10
                    plan = self.plan_route(tr)
                    if plan is None and tr.route is None:
                        continue
                    if plan is not None:
                        tr.route, tr.route_value = plan[:3], plan[3]
                    tr.task, tr.eta = "to_source", tr.city.dist(tr.route[0]) / TRADER_SPEED + 2
                elif tr.task == "to_source":
                    tr.eta -= dt
                    if tr.eta > 0:
                        continue
                    src, dst, _ = tr.route
                    load, _, cost = self.fill_wagon(self.transport_orders(src, dst), TRADER_CAPACITY)
                    if cost > tr.budget:
                        self.request_budget(tr, cost - tr.budget)
                    tr.city = src
                    for g, qty in load:
                        st = src.storage[g]
                        qty = min(qty, int(tr.budget / max(st.sell_price, 0.1)))
                        if qty <= 0:
                            continue
                        price = st.sell_price
                        net_to_port = price / (1 + CITY_TAX)
                        st.amount -= qty
                        st.flow_acc -= qty
                        tr.budget -= price * qty
                        src.cash += net_to_port * qty
                        src.tax_income += (price - net_to_port) * qty
                        src.income_rate += net_to_port * qty
                        tr.cargo.append((g, qty, price))
                    if not tr.cargo:
                        tr.task, tr.route, tr.route_value = "idle", None, 0.0
                        continue
                    tr.task, tr.eta = "to_dest", src.dist(dst) / TRADER_SPEED + 2
                elif tr.task == "to_dest":
                    tr.eta -= dt
                    if tr.eta > 0:
                        continue
                    _, dst, _ = tr.route
                    profit = 0.0
                    for g, qty, paid in tr.cargo:
                        st = dst.storage[g]
                        price = st.buy_price
                        gross = price * (1 + CITY_TAX)       # port pays price + tax
                        qty = min(qty, st.max_amount - st.amount, int(dst.cash / gross))
                        st.amount += qty
                        st.flow_acc += qty
                        dst.cash -= gross * qty
                        dst.tax_income += (gross - price) * qty
                        dst.spend_rate += gross * qty
                        tr.budget += price * qty
                        profit += (price - paid) * qty   # unsold units are written off
                    gd.earned += profit
                    tr.profit_avg += (profit - tr.profit_avg) * 0.2
                    tr.cargo, tr.task, tr.city = [], "idle", dst
                    # surplus trader cash flows back to the guild bank
                    if tr.budget > TRADER_BUDGET_KEEP:
                        gd.cash += tr.budget - TRADER_BUDGET_KEEP
                        tr.budget = TRADER_BUDGET_KEEP
            # guild expansion / contraction
            reserve = MONEY_RESERVE_TIME * 1.0 * len(gd.traders)
            if gd.cash > reserve + NEW_TRADER_COST * 2 and len(gd.traders) < 12:
                avg = sum(t.profit_avg for t in gd.traders) / len(gd.traders)
                if avg > MIN_PROFIT * 5:
                    gd.cash -= NEW_TRADER_COST
                    gd.traders.append(Trader(gd, self.rng.choice(self.cities)))
            elif gd.cash < 0 and len(gd.traders) > 1:
                gd.traders.pop()
                gd.cash += NEW_TRADER_COST * 0.5

    # ---------------------------------------------------------- loop
    def step(self, dt=TICK):
        self.t += dt
        self.produce_and_consume(dt)
        self.local_values()
        self.price_ports(dt)
        self.update_global_prices(dt)
        self.run_traders(dt)
        for c in self.cities:          # decay flow-rate accumulators (~60 s window)
            c.income_rate *= 1 - dt / 60
            c.spend_rate *= 1 - dt / 60

    def snapshot(self):
        row = {"t": round(self.t)}
        for g in GOODS:
            row[f"glob_{g}"] = round(self.glob[g], 2)
        for c in self.cities:
            row[f"{c.name}_cash"] = round(c.cash)
            row[f"{c.name}_pop"] = round(c.population)
        for gd in self.guilds:
            row[f"{gd.name}_cash"] = round(gd.cash)
            row[f"{gd.name}_traders"] = len(gd.traders)
        return row

    def report(self):
        print(f"\n=== t = {self.t:.0f}s ===")
        print("good    theo   global  " + "  ".join(f"{c.name[:7]:>17}" for c in self.cities))
        for g in GOODS:
            cells = []
            for c in self.cities:
                st = c.storage[g]
                side = "B" if st.amount < st.desired else "S"
                p = st.buy_price if side == "B" else st.sell_price
                cells.append(f"{st.amount:3d} {side} {p:6.2f} p{st.priority:.2f}")
            print(f"{g:7s} {self.theo[g]:5.2f} {self.glob[g]:7.2f}  " + "  ".join(cells))
        print("cities: " + "  ".join(
            f"{c.name}: cash {c.cash:7.0f} tax {c.tax_income:6.0f} pop {c.population:4.0f} sat {c.satisfaction:.2f}"
            for c in self.cities))
        print("guilds: " + "  ".join(
            f"{g.name}: cash {g.cash:7.0f} traders {len(g.traders)} profit {g.earned:7.0f}" for g in self.guilds))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=3600)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--report-every", type=int, default=600)
    ap.add_argument("--csv")
    a = ap.parse_args()
    eco = Economy(a.seed)
    rows = []
    for s in range(a.seconds):
        eco.step()
        if (s + 1) % 30 == 0:
            rows.append(eco.snapshot())
        if (s + 1) % a.report_every == 0:
            eco.report()
    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows)} rows to {a.csv}")


if __name__ == "__main__":
    main()

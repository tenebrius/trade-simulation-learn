"""
Minimal trade-economy simulation modelled on the mechanics recovered from
Let Them Trade (see economy_model.md). Original implementation, no game code.

Fixed set of cities. Each city has:
  - a trade port (storage per good, cash bank, buy/sell prices per good)
  - production buildings (recipes) staffed by residents; productivity = staffed share
  - housing with residents who consume goods, get happier or unhappier, pay coins,
    and move in or out by the game's occupancy-vs-happiness rule
  - city buyers: wagons owned by the city that fetch goods from other ports and bring them home
Optional (--guilds): the legacy guild layer, where guilds lease branches and own traders. The
shipped game never founds guilds in a new game, so this is off by default.

Run:  python ltt_sim.py [--seconds 3600] [--seed 1] [--csv out.csv] [--guilds]
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
CITY_TAX = 0.10                 # EconomyConstants.StartCityTax (%)
CITY_START_BUDGET = 1000.0
MIN_PROFIT = 1.0                # TradeGuild.DefaultMinProfitToConsiderTrade
MONEY_RESERVE_TIME = 60.0       # TradeGuild.MoneyReserveTime
ROUTE_SWITCH_TIMEOUT = 30.0     # TradeGuild.TraderRouteSwitchTimeOut
MAX_PROFIT_DEV = 0.5            # TraderConstants.MaxProfitDeviationFraction
GUILD_EMERGENCY_RESERVE = 100.0 # (simplification) guild never lends below this
TRADER_CAPACITY = 10
TRADER_SPEED = 1.0              # distance units / second
# city buyers
NUM_CITY_BUYERS = 2             # CityConstants.NumCityBuyers
# guilds and branches
BRANCH_COST = 200.0             # TradeGuild.SpawnGuildBranchDefaultCost (stand-in for the wagon price)
BRANCH_LEASE = 0.1              # TradeGuild.DefaultBranchLease, coins per second paid to the port
INCLUDED_LEASE_TIME = 120.0     # TradeGuild.IncludedFoundingLeaseTime (prepaid lease on founding)
FOUND_BRANCH_TIMEOUT = 60.0     # TradeGuild.FoundNewBranchTimeOut (cooldown after each branch)
NEW_GUILD_COST = 500.0          # TradeGuild.SpawnNewGuildDefaultCost, paid by the founding port
MAX_GUILDS = 3                  # (sim) game default MaxSimultaneousFreeTradeGuilds is 5
GUILD_FOUNDING_TIMEOUT = 300.0  # (assumption) default not recovered; x0.1 when no guild is left
# residents (C++ defaults; the game's data assets may override them)
MAX_MOVE_PROB = 0.1             # CityConstants.MaxMoveInProbabilityPerSec (used for in AND out)
HAPPINESS_SPEED = 0.01          # InhabitantSpecs.MaxRelativeHappinessChangeSpeed
CRITICAL_HAPPINESS = 0.5        # (assumption) residential CriticalAverageHappiness
BASE_HAPPINESS, JOB_HAPPINESS, UNEMPLOYED_HAPPINESS = 0.5, 0.1, -0.15   # (sim values)
BASE_PAY, BONUS_PAY = 0.03, 0.03  # per resident per second; C++ defaults are 1.0/1.0, scaled to sim prices
PAY_INTERVAL = 10.0             # (assumption) CoinConstants.ResidenceCoinPayInterval
WORKERS_PER_BUILDING = 8
# theoretical price solver (PricingPrediction)
THEO_MAX_STEP, THEO_PASSES, THEO_TOL, THEO_FLOOR = 0.01, 10, 0.001, 0.01

# ---------------------------------------------------------------- world data
GOODS = ["grain", "wood", "fish", "flour", "bread", "tools"]
RECIPES = {  # output: (inputs{good: qty}, out_qty, seconds_per_cycle, labour per cycle)
    "grain": ({}, 2, 10.0, 1),
    "wood": ({}, 2, 10.0, 1),
    "fish": ({}, 1, 8.0, 1),
    "flour": ({"grain": 2}, 2, 10.0, 1),
    "bread": ({"flour": 2}, 3, 12.0, 1),
    "tools": ({"wood": 3}, 1, 15.0, 2),
}
# per resident per second, supply happiness (luxury bonus), undersupply happiness (penalty)
NEEDS = {"bread": (0.0025, 0.0, -0.35), "fish": (0.0015, 0.0, -0.2), "tools": (0.0004, 0.15, 0.0)}

CITY_SETUP = [  # name, (x, y), residents, housing capacity, buildings
    ("Ashford", (0, 0), 30, 60, ["grain", "grain", "flour", "bread"]),
    ("Brindle", (40, 10), 30, 50, ["wood", "wood", "tools", "fish"]),
    ("Corran", (15, 45), 30, 45, ["fish", "fish", "grain", "flour"]),
    ("Dunmere", (55, 50), 25, 55, ["wood", "bread", "tools"]),
]
GUILD_NAMES = ["Red Hand", "Silver Wheel", "Gilded Oar", "Iron Scale"]
START_GUILDS = [("Red Hand", "Ashford"), ("Silver Wheel", "Brindle")]


def recipe_values(seed, old=None):
    """PricingPrediction: value = (sum of input amount x input value + labour x seed) / output amount.
    Labour (inhabitants) is the only base input and is worth `seed`. Each pass moves a value by at
    most THEO_MAX_STEP; passes stop once every relative change is below THEO_TOL."""
    val = dict(old) if old else {g: 1.0 for g in GOODS}
    for _ in range(THEO_PASSES):
        done = True
        for good, (inputs, out_qty, _, labour) in RECIPES.items():
            new = (sum(val[i] * q for i, q in inputs.items()) + labour * seed) / out_qty
            if math.isnan(new) or new <= 0:
                new = THEO_FLOOR
            prev = val[good]
            rel = (new - prev) / prev
            if abs(rel) > THEO_TOL:
                done = False
                if abs(rel) > THEO_MAX_STEP:
                    new = prev * (1 + math.copysign(THEO_MAX_STEP, rel))
            val[good] = new
        if done:
            break
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
    workers: int = 0


@dataclass
class City:
    name: str
    pos: tuple
    residents: int
    capacity: int                # housing slots
    buildings: list
    cash: float = CITY_START_BUDGET
    tax_income: float = 0.0
    storage: dict = field(default_factory=dict)
    income_rate: float = 0.0
    spend_rate: float = 0.0
    new_port_timer: float = NEW_PORT_BONUS_T
    happiness: float = BASE_HAPPINESS        # average over residents
    target_happiness: float = BASE_HAPPINESS
    satisfaction: dict = field(default_factory=dict)   # per need: share of demand met
    consume_acc: dict = field(default_factory=dict)
    pay_timer: float = 0.0
    employed: int = 0

    def dist(self, other):
        return math.dist(self.pos, other.pos)


@dataclass
class Trader:
    guild: "Guild"               # owning guild, or None for a city buyer
    city: City                   # where the wagon currently is
    home: City = None            # city buyer's home city (TraderAllegiance)
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
    cash: float = 0.0
    traders: list = field(default_factory=list)
    branches: dict = field(default_factory=dict)   # city name -> prepaid lease credit
    earned: float = 0.0
    branch_timer: float = 0.0                      # FoundNewBranchTimer
    route_profit: dict = field(default_factory=dict)  # (src, dst) -> total gross profit


class Economy:
    def __init__(self, seed=1, guilds=False):
        self.rng = random.Random(seed)
        self.t = 0.0
        self.seed_value, self.seed_delta = 1.0, 0.1    # TheoreticalMarketSeedValue / its step
        self.theo = recipe_values(self.seed_value)
        for _ in range(200):                           # settle the solver before the first tick
            self.theo = recipe_values(self.seed_value, self.theo)
        self.mean = dict(self.theo)          # MeanMarketPrice
        self.glob = dict(self.theo)          # GlobalMarketPrice
        self.cities = []
        for name, pos, res, cap, bld in CITY_SETUP:
            c = City(name, pos, res, cap, [Building(b) for b in bld])
            for g in GOODS:
                c.storage[g] = Storage(g, amount=self.rng.randint(10, 40))
                c.consume_acc[g] = 0.0
            c.satisfaction = {g: 1.0 for g in NEEDS}
            self.cities.append(c)
        self.buyers = [Trader(None, c, home=c) for c in self.cities for _ in range(NUM_CITY_BUYERS)]
        self.use_guilds = guilds
        self.guilds = []
        self.founding_timer = GUILD_FOUNDING_TIMEOUT
        if guilds:
            for gname, cname in START_GUILDS:
                self.found_guild(gname, self.city(cname))
        self.log = []

    def city(self, name):
        return next(c for c in self.cities if c.name == name)

    # ---------------------------------------------------------- production
    def produce(self, dt):
        """Productivity = staffed share of a building's worker slots. Inputs are taken when a
        cycle starts; progress advances by dt / cycle time x productivity; output lands at 1.0."""
        for c in self.cities:
            free = c.residents
            for b in c.buildings:
                b.workers = min(WORKERS_PER_BUILDING, free)
                free -= b.workers
            c.employed = c.residents - free
            for b in c.buildings:
                inputs, out_qty, secs, _ = RECIPES[b.output]
                st_out = c.storage[b.output]
                if not b.running:
                    if all(c.storage[i].amount >= q for i, q in inputs.items()):
                        for i, q in inputs.items():
                            c.storage[i].amount -= q
                            c.storage[i].flow_acc -= q
                        b.running, b.progress = True, 0.0
                if b.running and b.progress < 1.0:
                    b.progress += dt / secs * (b.workers / WORKERS_PER_BUILDING)
                if b.running and b.progress >= 1.0 and st_out.amount + out_qty <= st_out.max_amount:
                    st_out.amount += out_qty          # blocked while the output storage is full
                    st_out.flow_acc += out_qty
                    b.running = False

    # ---------------------------------------------------------- residents
    def residents(self, dt):
        for c in self.cities:
            # consumption: each need draws demand x dt; satisfaction = share of that demand met
            for g, (rate, _, _) in NEEDS.items():
                c.consume_acc[g] += rate * c.residents * dt
                n = int(c.consume_acc[g])
                if n:
                    take = min(n, c.storage[g].amount)
                    c.storage[g].amount -= take
                    c.storage[g].flow_acc -= take
                    c.consume_acc[g] -= n
                    c.satisfaction[g] = take / n
            # target happiness: base + per need (satisfaction x supply bonus, or
            # shortfall x undersupply penalty) + job / unemployment share
            target = BASE_HAPPINESS
            for g, (_, supply_h, under_h) in NEEDS.items():
                s = c.satisfaction[g]
                if s > 0 and supply_h:
                    target += s * supply_h
                elif under_h and s < 1:
                    target += (1 - s) * under_h
            if c.residents:
                emp = c.employed / c.residents
                target += emp * JOB_HAPPINESS + (1 - emp) * UNEMPLOYED_HAPPINESS
            c.target_happiness = max(0.0, min(1.0, target))
            # happiness eases toward the target: step = dt x speed x max(|gap|, 0.1)
            gap = c.target_happiness - c.happiness
            step = dt * HAPPINESS_SPEED * max(abs(gap), 0.1)
            c.happiness = c.target_happiness if abs(gap) <= step else c.happiness + math.copysign(step, gap)
            self.migrate(c, dt)
            # coin payment every PAY_INTERVAL: residents x (base + happiness factor x bonus)
            c.pay_timer += dt
            if c.pay_timer >= PAY_INTERVAL:
                c.pay_timer -= PAY_INTERVAL
                hf = max(0.0, (c.happiness - CRITICAL_HAPPINESS) / (1 - CRITICAL_HAPPINESS))
                pay = PAY_INTERVAL * c.residents * (BASE_PAY + hf * BONUS_PAY)
                c.cash += pay
                c.income_rate += pay

    def migrate(self, c, dt):
        """Compare happiness (relative to the critical level) with housing occupancy.
        Happier than the occupancy -> chance to fill an empty slot; less happy -> chance to leave.
        Each candidate slot rolls against (1 - rate)^dt; the first success moves one resident."""
        if c.capacity <= 0:
            return
        occ = c.residents / c.capacity
        h = max(0.0, min(1.0, c.happiness / CRITICAL_HAPPINESS))
        if h >= occ:
            if occ < 1:
                stay = (1 - (h - occ) / (1 - occ) * MAX_MOVE_PROB) ** dt
                for _ in range(c.capacity - c.residents):
                    if self.rng.random() > stay:
                        c.residents += 1
                        break
        else:
            h2 = max(0.0, min(1.0, max(c.target_happiness, c.happiness) / CRITICAL_HAPPINESS))
            if h2 < occ:
                stay = (1 - (occ - h2) / occ * MAX_MOVE_PROB) ** dt
                for _ in range(c.residents):
                    if self.rng.random() > stay:
                        c.residents -= 1
                        break

    def local_values(self):
        """Local value of a good: what it is worth to this city's producers/consumers."""
        for c in self.cities:
            made_here = {b.output for b in c.buildings}
            for g, st in c.storage.items():
                v = self.theo[g]
                if g in made_here:
                    inputs, out_qty, _, _ = RECIPES[g]
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
        cash = sum(c.cash for c in self.cities)   # the "cities" budget total
        # Theoretical seed (value of labour): an adaptive step that grows 10% while the error keeps
        # its sign and flips at 90% when it changes, until cash ~ DESIRED_CASH_TO_GOODS x theo value.
        theo_value = sum(volume[g] * self.theo[g] for g in GOODS)
        err = cash - DESIRED_CASH_TO_GOODS * theo_value
        if err != 0:
            same = (err > 0) == (self.seed_delta > 0)
            self.seed_delta *= 1.1 if same else -0.9
            self.seed_value = max(0.01, self.seed_value + self.seed_delta * dt)
        self.theo = recipe_values(self.seed_value, self.theo)
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
                # a city buyer serves routes touching its home and never loads there: it only imports
                if tr.home is not None and (dst is not tr.home or src is tr.home):
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
        """Trader asks its owner for cash: full gap, then half, then a quarter. A guild lends only
        above its emergency reserve; a home port lends whenever its bank covers the amount."""
        owner = tr.guild or tr.home
        for part in (amount, amount * 0.5, amount * 0.25):
            ok = part < owner.cash - GUILD_EMERGENCY_RESERVE if tr.guild else part <= owner.cash
            if ok:
                owner.cash -= part
                tr.budget += part
                return True
        return False

    def run_traders(self, dt):
        for tr in self.buyers + [t for gd in self.guilds for t in gd.traders]:
            gd = tr.guild
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
                if gd:
                    gd.earned += profit
                    key = (tr.route[0].name, dst.name)
                    gd.route_profit[key] = gd.route_profit.get(key, 0.0) + profit
                tr.profit_avg += (profit - tr.profit_avg) * 0.2
                tr.cargo, tr.task, tr.city = [], "idle", dst
                # after delivering, the trader hands all its cash back to its owner
                (gd or tr.home).cash += tr.budget
                tr.budget = 0.0

    # ---------------------------------------------------------- guilds
    def found_guild(self, name, port):
        """The founding port pays NEW_GUILD_COST (or what it has) into the new guild's account;
        the guild then opens its first branch there."""
        pay = min(NEW_GUILD_COST, port.cash)
        port.cash -= pay
        gd = Guild(name, cash=pay)
        self.guilds.append(gd)
        self.founding_timer = GUILD_FOUNDING_TIMEOUT
        self.open_branch(gd, port)
        return gd

    def can_afford_branch(self, gd):
        """GuildCanAffordNewBranch: cooldown over and cost + prepaid lease < account - reserve."""
        reserve = MONEY_RESERVE_TIME * BRANCH_LEASE * len(gd.branches)
        return gd.branch_timer <= 0 and BRANCH_COST + BRANCH_LEASE * INCLUDED_LEASE_TIME < gd.cash - reserve

    def open_branch(self, gd, port):
        """Pay for the branch with its prepaid lease, start the cooldown, and spawn one trader there.
        In the game the trader takes the guild route through this port with the highest gross profit."""
        cost = BRANCH_COST + BRANCH_LEASE * INCLUDED_LEASE_TIME
        if gd.cash < cost:
            return False
        gd.cash -= cost
        port.cash += BRANCH_COST
        gd.branches[port.name] = BRANCH_LEASE * INCLUDED_LEASE_TIME
        gd.branch_timer += FOUND_BRANCH_TIMEOUT
        gd.traders.append(Trader(gd, port))
        return True

    def scrap(self, gd, tr):
        gd.cash += tr.budget
        tr.budget = 0.0
        gd.traders.remove(tr)

    def run_guilds(self, dt):
        for gd in list(self.guilds):
            gd.branch_timer = max(0.0, gd.branch_timer - dt)
            # branch lease: prepaid credit first, then the guild account
            short = []
            for cname in gd.branches:
                due = BRANCH_LEASE * dt
                from_credit = min(due, gd.branches[cname])
                gd.branches[cname] -= from_credit
                paid = from_credit + min(due - from_credit, max(0.0, gd.cash))
                gd.cash -= paid - from_credit
                self.city(cname).cash += paid
                if due > paid:
                    short.append((cname, due - paid))
            owed = sum(a for _, a in short)
            if owed > 0:
                # short: pull cash back from traders; every trader drained this way is scrapped
                for tr in list(gd.traders):
                    if gd.cash >= owed:
                        break
                    if tr.budget > 0:
                        self.scrap(gd, tr)
                for cname, amount in short:
                    pay = min(amount, max(0.0, gd.cash))
                    gd.cash -= pay
                    self.city(cname).cash += pay
                    owed -= pay
                if owed > 1e-9:   # still short: the guild dissolves
                    for tr in list(gd.traders):
                        self.scrap(gd, tr)
                    self.guilds.remove(gd)
                    self.founding_timer = GUILD_FOUNDING_TIMEOUT * (0.1 if not self.guilds else 1.0)
                    continue
            # stand-in for the Blueprint-side expansion decision: open a branch in the city
            # (without one) that the guild's best-earning route touches, else the nearest city
            if self.can_afford_branch(gd):
                missing = [c for c in self.cities if c.name not in gd.branches]
                if missing:
                    best = max(gd.route_profit.items(), key=lambda kv: kv[1], default=None)
                    pick = next((c for c in missing if best and c.name in best[0]), None)
                    if pick is None:
                        home = self.city(next(iter(gd.branches)))
                        pick = min(missing, key=home.dist)
                    self.open_branch(gd, pick)
        # stand-in for Blueprint-side guild founding: after the cooldown the richest port founds one
        self.founding_timer -= dt
        if self.founding_timer <= 0 and len(self.guilds) < MAX_GUILDS:
            names = [n for n in GUILD_NAMES if n not in {g.name for g in self.guilds}]
            port = max(self.cities, key=lambda c: c.cash)
            if names and port.cash > 2 * NEW_GUILD_COST:
                self.found_guild(names[0], port)
            else:
                self.founding_timer = GUILD_FOUNDING_TIMEOUT

    # ---------------------------------------------------------- loop
    def step(self, dt=TICK):
        self.t += dt
        self.produce(dt)
        self.residents(dt)
        self.local_values()
        self.price_ports(dt)
        self.update_global_prices(dt)
        self.run_traders(dt)
        if self.use_guilds:
            self.run_guilds(dt)
        for c in self.cities:          # decay flow-rate accumulators (~60 s window)
            c.income_rate *= 1 - dt / 60
            c.spend_rate *= 1 - dt / 60

    def snapshot(self):
        row = {"t": round(self.t)}
        for g in GOODS:
            row[f"glob_{g}"] = round(self.glob[g], 2)
        for c in self.cities:
            row[f"{c.name}_cash"] = round(c.cash)
            row[f"{c.name}_pop"] = c.residents
            row[f"{c.name}_happy"] = round(c.happiness, 3)
        row["theo_seed"] = round(self.seed_value, 3)
        row["buyers_profit_avg"] = round(sum(t.profit_avg for t in self.buyers) / max(len(self.buyers), 1), 2)
        for name in GUILD_NAMES if self.use_guilds else []:
            gd = next((g for g in self.guilds if g.name == name), None)
            row[f"{name}_cash"] = round(gd.cash) if gd else ""
            row[f"{name}_traders"] = len(gd.traders) if gd else 0
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
            f"{c.name}: cash {c.cash:7.0f} tax {c.tax_income:6.0f} pop {c.residents:3d}/{c.capacity} "
            f"happy {c.happiness:.2f}" for c in self.cities))
        print(f"labour seed {self.seed_value:.3f}")
        print("city buyers: " + "  ".join(
            f"{c.name}: " + ",".join(f"{t.task}@{t.city.name[:3]}" for t in self.buyers if t.home is c)
            for c in self.cities))
        if not self.use_guilds:
            return
        print("guilds: " + "  ".join(
            f"{g.name}: cash {g.cash:7.0f} traders {len(g.traders)} branches {len(g.branches)} "
            f"profit {g.earned:7.0f}" for g in self.guilds))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=3600)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--report-every", type=int, default=600)
    ap.add_argument("--csv")
    ap.add_argument("--guilds", action="store_true", help="enable the legacy guild layer")
    a = ap.parse_args()
    eco = Economy(a.seed, guilds=a.guilds)
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

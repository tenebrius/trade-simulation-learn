"""mulberry32, bit-for-bit identical to web/src/engine/rng.ts."""
M = 0xFFFFFFFF


def _imul(a, b):
    r = (a * b) & M
    return r


class Mulberry32:
    def __init__(self, seed):
        self.s = seed & M

    def random(self):
        self.s = (self.s + 0x6D2B79F5) & M
        t = self.s
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & M
        return ((t ^ (t >> 14)) & M) / 4294967296

    def uniform(self, a, b):
        return a + (b - a) * self.random()

    def randint(self, a, b):
        return a + int(self.random() * (b - a + 1))

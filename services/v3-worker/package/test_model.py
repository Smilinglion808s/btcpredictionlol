import math
import unittest
from model import FEATURES, prefix_features, rank_before_append, select


class ModelTests(unittest.TestCase):
    def test_rank_boundaries_and_ties(self):
        self.assertIsNone(rank_before_append(.6, [.1] * 191))
        self.assertEqual(rank_before_append(.5, [0] * 192), 1)
        self.assertEqual(rank_before_append(.5, [.1] * 768 + [0] * 768), 1)

    def test_precedence_and_no_fallback(self):
        self.assertEqual(select({"probability": .4, "rank": .7}, {"probability": .6, "rank": 1}),
                         {"checkpoint": 15, "direction": -1})
        self.assertIsNone(select({"probability": .4, "rank": .699}, None))
        self.assertEqual(select(None, {"probability": .5, "rank": .7})["direction"], 1)

    def test_quote_prefix(self):
        bars = [{"open_ms": i * 1000, "close_ms": i * 1000 + 999, "is_final": True,
                 "open": 100., "close": 101., "high": 102., "low": 99.,
                 "quote_volume": 100., "taker_buy_quote_volume": 75.} for i in range(30)]
        x = prefix_features(bars[:15], 15, 0)
        self.assertEqual(len(x), len(FEATURES[15]))
        self.assertAlmostEqual(x[0], math.log(1.01) * 10000)
        self.assertEqual(x[2:], [300., .5, .5])
        bars[20]["quote_volume"] = 10000.
        self.assertEqual(prefix_features(bars[:15], 15, 0), x)
        with self.assertRaises(ValueError):
            prefix_features(bars[1:15], 15, 0)
        bars[0]["is_final"] = False
        with self.assertRaises(ValueError):
            prefix_features(bars[:15], 15, 0)


if __name__ == "__main__":
    unittest.main()

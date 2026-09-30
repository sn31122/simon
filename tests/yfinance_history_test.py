"""Offline tests of the price/source contract, file hooks and rollback."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("history", Path(__file__).resolve().parents[1] / "data/yfinance_history.py")
H = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(H)
ISIN, OTHER = "US0378331005", "US5949181045"
HIST_DAYS = ["2025-12-29", "2025-12-30", "2025-12-31"]
DAILY_DAYS = ["2026-01-02", "2026-01-05", "2026-01-06"]


class FakeProvider:
    def __init__(self, currency="EUR"):
        self.currency = currency
        self.calls = 0

    def identity(self, isin, symbol):
        return "fixture_exact_isin_search_hit"

    def series(self, symbol, start, end):
        self.calls += 1
        values = [80, 90, 100, 100, 110, 99]
        fx = symbol == "EURUSD=X"
        return {"currency": "USD" if fx else self.currency,
                "timezone": "Europe/Berlin", "exchange": "fixture",
                "closes": dict(zip(HIST_DAYS + DAILY_DAYS, [1.2] * 6 if fx else
                                   [v * 1.2 if self.currency == "USD" else v for v in values])),
                "missing_dates": [], "yfinance_version": "fixture"}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        daily_fields = ["date", "status", "asof_utc", ISIN, OTHER]
        self.write("data/prices_daily.csv", daily_fields, [dict(zip(daily_fields, [d, "final", "", str(v), "200"]))
                                                          for d, v in zip(DAILY_DAYS, [100, 110, 99])])
        fields = ["date", "res", ISIN, OTHER]
        self.write("data/prices_history.csv", fields, [dict(zip(fields, ["2025-11-28", "m", "75", "190"]))])
        fields = ["isin", "symbol", "currency", "enabled", "identity_status", "reason"]
        self.write("data/yfinance_symbols.csv", fields, [dict(zip(fields, [ISIN, "TEST", "EUR", "1", "reverse_isin_matches", ""])),
                                                         dict(zip(fields, [OTHER, "OTHER", "EUR", "0", "reverse_isin_mismatch", "identity mismatch"]))])
        fields = ["isin", "name"]
        self.write("data/instruments.csv", fields, [{"isin": ISIN, "name": "A"}, {"isin": OTHER, "name": "B"}])
        for name in ["HANDOFF.md", "data/portfolio-data.js", "tests/reference.json"]:
            H.atomic_bytes(self.root / name, b"original\n")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, fields, rows):
        H.atomic_bytes(self.root / name, H.csv_bytes(fields, rows))

    def plan(self, currency="EUR"):
        if currency != "EUR":
            fields, rows = H.read_csv(self.root / "data/yfinance_symbols.csv")
            rows[0]["currency"] = currency
            self.write("data/yfinance_symbols.csv", fields, rows)
        return H.plan_history(self.root, [ISIN], "2025-12-29", policy="fx" if currency != "EUR" else "native")["run_id"]

    def stage(self, currency="EUR"):
        run = self.plan(currency)
        summary = H.fetch_batch(self.root, run, 1, FakeProvider(currency))
        self.assertEqual(summary["status"], "saved")
        return run

    def checks(self, root, directory):
        H.atomic_bytes(root / "data/portfolio-data.js", b"rebuilt\n")
        H.atomic_bytes(root / "tests/reference.json", b"reference\n")
        return ["fixture checks passed"]

    def test_only_close_native_currency_and_protected_files(self):
        before = {name: H.digest(self.root / name) for name in H.PROTECTED}
        result = H.finalize(self.root, self.stage(), check_runner=self.checks)
        self.assertEqual(result["imported_rows"], 3)
        self.assertEqual(before, {name: H.digest(self.root / name) for name in H.PROTECTED})
        fields, rows = H.read_csv(self.root / "data/yfinance_sources.csv")
        self.assertEqual(fields, H.SOURCE_FIELDS)
        self.assertFalse({"Open", "High", "Low", "Volume", "Adj Close", "Dividends", "Stock Splits"} & set(fields))
        self.assertEqual([float(r["close_eur"]) for r in rows], [80, 90, 100])
        _, rows = H.read_csv(self.root / "data/prices_history.csv")
        self.assertEqual([r["date"] for r in rows], ["2025-11-28"] + HIST_DAYS)
        self.assertEqual(rows[0][OTHER], "190")
        self.assertTrue(all(r[OTHER] == "" for r in rows[1:]))

    def test_fx_keeps_native_values_and_exact_rate_provenance(self):
        run = self.stage("USD")
        H.finalize(self.root, run, check_runner=self.checks)
        _, rows = H.read_csv(self.root / "data/yfinance_sources.csv")
        self.assertAlmostEqual(float(rows[0]["close"]), 96)
        self.assertAlmostEqual(float(rows[0]["close_eur"]), 80)
        self.assertEqual(rows[0]["fx_symbol"], "EURUSD=X")
        self.assertEqual(rows[0]["fx_date"], HIST_DAYS[0])

    def test_cached_batch_does_not_download_again(self):
        run = self.stage()
        provider = FakeProvider()
        H.fetch_batch(self.root, run, 1, provider)
        self.assertEqual(provider.calls, 0)

    def test_fx_is_shared_once_per_run_and_corruption_is_refused(self):
        run = self.plan("USD")
        directory, plan = H.load_plan(self.root, run)
        provider = FakeProvider("USD")
        first = H.shared_fx_series(directory, plan, "EURUSD=X", provider)
        second = H.shared_fx_series(directory, plan, "EURUSD=X", provider)
        self.assertEqual(first["closes"], second["closes"])
        self.assertEqual(provider.calls, 1)
        H.atomic_bytes(directory / "fx/EURUSD_X.csv", b"date,close\n2025-12-31,9\n")
        with self.assertRaisesRegex(H.HistoryError, "checksum/plan mismatch"):
            H.shared_fx_series(directory, plan, "EURUSD=X", provider)

    def test_repeated_commit_is_idempotent(self):
        run = self.stage()
        H.finalize(self.root, run, check_runner=self.checks)
        before = H.digest(self.root / "data/prices_history.csv")
        result = H.finalize(self.root, run, check_runner=self.checks)
        self.assertEqual(result["status"], "already_applied")
        self.assertEqual(H.digest(self.root / "data/prices_history.csv"), before)

    def test_repeated_commit_survives_documentation_or_generated_timestamp_changes(self):
        run = self.stage()
        H.finalize(self.root, run, check_runner=self.checks)
        H.atomic_bytes(self.root / 'HANDOFF.md', b'updated docs')
        H.atomic_bytes(self.root / 'data/portfolio-data.js', b'new timestamp')
        self.assertEqual(H.finalize(self.root, run, check_runner=self.checks)['status'], 'already_applied')

    def test_scalable_history_refresh_keeps_yahoo_overlay_and_other_columns(self):
        H.finalize(self.root, self.stage(), check_runner=self.checks)
        fields = ['date', 'res', ISIN, OTHER]
        self.write('data/prices_history.csv', fields, [dict(zip(fields, ['2025-12-31', 'm', '1', '999']))])
        H.restore_overlay(self.root)
        _, rows = H.read_csv(self.root / 'data/prices_history.csv')
        self.assertEqual([r['date'] for r in rows], HIST_DAYS)
        self.assertEqual(rows[-1][ISIN], '100')
        self.assertEqual(rows[-1][OTHER], '999')
        self.assertEqual(rows[-1]['res'], 'd')

    def test_failed_checks_restore_csv_generated_files_and_handoff(self):
        run = self.stage()
        names = ["data/prices_history.csv", "data/portfolio-data.js", "tests/reference.json", "HANDOFF.md"]
        before = {name: (self.root / name).read_bytes() for name in names}
        def fail(root, directory):
            self.checks(root, directory)
            H.atomic_bytes(root / "HANDOFF.md", b"damaged")
            raise H.HistoryError("intentional failed check")
        with self.assertRaisesRegex(H.HistoryError, "intentional"):
            H.finalize(self.root, run, check_runner=fail)
        self.assertEqual(before, {name: (self.root / name).read_bytes() for name in names})
        self.assertFalse((self.root / "data/yfinance_sources.csv").exists())
        self.assertFalse((self.root / "data/yfinance_status.json").exists())
        self.assertFalse((self.root / "data/yfinance/merge.lock").exists())

    def test_stale_plan_is_refused(self):
        run = self.stage()
        path = self.root / "data/prices_daily.csv"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(H.HistoryError, "changed after planning"):
            H.finalize(self.root, run, check_runner=self.checks)

    def test_corrupt_staged_file_is_refused(self):
        run = self.stage()
        staged = H.run_dir(self.root, run) / "staged" / f"{ISIN}.csv"
        fields, rows = H.read_csv(staged)
        rows[0]["close"] = "800"
        H.atomic_bytes(staged, H.csv_bytes(fields, rows))
        with self.assertRaisesRegex(H.HistoryError, "Incomplete/invalid"):
            H.finalize(self.root, run, check_runner=self.checks)

    def test_self_consistent_checksum_cannot_hide_wrong_fx_calculation(self):
        run = self.stage("USD")
        directory, plan = H.load_plan(self.root, run)
        staged = directory / "staged" / f"{ISIN}.csv"
        fields, rows = H.read_csv(staged)
        rows[0]["close_eur"] = "1.0"
        H.atomic_bytes(staged, H.csv_bytes(fields, rows))
        receipt = H.read_json(directory / "receipts" / f"{ISIN}.json")
        receipt["sha256"] = H.digest(staged)
        with self.assertRaisesRegex(H.HistoryError, "incorrect EUR"):
            H.validate_staged(directory, plan, plan["entries"][0], receipt)

    def test_missing_batch_is_refused(self):
        with self.assertRaisesRegex(H.HistoryError, "Incomplete/invalid"):
            H.finalize(self.root, self.plan(), check_runner=self.checks)

    def test_date_range_cannot_enter_recent_scalable_prices(self):
        for end in ("2026-01-02", "2026-01-03"):
            with self.assertRaisesRegex(H.HistoryError, "strictly before"):
                H.plan_history(self.root, [ISIN], "2025-12-29", end)
        result = H.plan_history(self.root, [ISIN])
        self.assertEqual(H.load_plan(self.root, result["run_id"])[1]["end"], "2026-01-01")

    def test_unknown_isin_or_native_policy_foreign_selection_refused(self):
        with self.assertRaisesRegex(H.HistoryError, "Unknown ISIN"):
            H.plan_history(self.root, ["DE000INVALID1"])
        self.plan("USD")
        with self.assertRaisesRegex(H.HistoryError, "No eligible"):
            H.plan_history(self.root, [ISIN], policy="native")

    def test_scale_mismatch_does_not_stage(self):
        run = self.plan("USD")
        class WrongScale(FakeProvider):
            def series(self, symbol, start, end):
                data = super().series(symbol, start, end)
                if symbol != "EURUSD=X":
                    data["closes"] = {d: v * 100 for d, v in data["closes"].items()}
                return data
        result = H.fetch_batch(self.root, run, 1, WrongScale("USD"))
        self.assertEqual(result["status"], "failed")
        self.assertFalse((H.run_dir(self.root, run) / "receipts" / f"{ISIN}.json").exists())

    def test_lock_is_exclusive(self):
        path = self.root / "data/yfinance/merge.lock"
        with H.lock(path):
            with self.assertRaisesRegex(H.HistoryError, "Another operation"):
                with H.lock(path):
                    pass
        self.assertFalse(path.exists())


class ContractTests(unittest.TestCase):
    def test_gbp_pence_and_fx_units(self):
        value, symbol, day, rate = H.eur_close("2025-12-31", 100, "GBp", {"2025-12-31": .8})
        self.assertAlmostEqual(value, 1.25)
        self.assertEqual((symbol, day, rate), ("EURGBP=X", "2025-12-31", .8))

    def test_fx_age_is_bounded_and_future_quotes_cannot_be_used(self):
        self.assertAlmostEqual(H.eur_close("2025-12-29", 120, "USD", {"2025-12-26": 1.2})[0], 100)
        for rates in ({"2025-12-24": 1.2}, {"2025-12-30": 1.2}, {}):
            with self.assertRaises(H.HistoryError):
                H.eur_close("2025-12-29", 120, "USD", rates)

    def test_unsafe_run_ids_and_invalid_prices_refused(self):
        for value in ("../escape", "", "20260930T000000Z-../oops"):
            with self.assertRaises(H.HistoryError):
                H.run_dir(Path("."), value)
        for value in ("NaN", "inf", "0", "-1"):
            with self.assertRaises(H.HistoryError):
                H.positive(value)

    def test_hook_ignores_unrelated_writes_and_invalid_requests(self):
        root = Path(__file__).resolve().parents[1]
        hook = root / ".claude/hooks/fetch-yfinance.cjs"
        result = subprocess.run(["node", str(hook)], input=json.dumps({"tool_name": "Write", "tool_input": {"file_path": "README.md"}}),
                                text=True, capture_output=True, cwd=root)
        self.assertEqual((result.returncode, result.stdout), (0, ""))
        result = subprocess.run(["node", str(hook), "--request", str(root / "README.md")], text=True, capture_output=True, cwd=root)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["status"], "error")

    def test_yahoo_provider_explicitly_uses_close_without_dividend_adjustment(self):
        class Column:
            def items(self):
                return [(dt.datetime(2025, 12, 31, tzinfo=dt.timezone.utc), 123.0)]
        class Frame:
            empty = False
            index = type("Index", (), {"tz": dt.timezone.utc})()
            def __contains__(self, name):
                return name == "Close"
            def __getitem__(self, name):
                self.asserted = name
                return Column()
        class Ticker:
            def history(self, **kwargs):
                self.options = kwargs
                return Frame()
            def get_history_metadata(self):
                return {"currency": "EUR", "exchangeTimezoneName": "Europe/Berlin"}
        ticker = Ticker()
        provider = H.YahooProvider.__new__(H.YahooProvider)
        provider.cache = {}
        provider.yf = type("YF", (), {"Ticker": staticmethod(lambda _: ticker), "__version__": "test"})()
        result = provider.series("TEST", "2025-12-31", "2026-01-01")
        self.assertEqual(result["closes"], {"2025-12-31": 123.0})
        self.assertEqual(ticker.options["interval"], "1d")
        self.assertFalse(ticker.options["auto_adjust"])
        self.assertFalse(ticker.options["back_adjust"])
        self.assertFalse(ticker.options["actions"])
        self.assertFalse(ticker.options["repair"])

    def test_live_fx_row_at_exclusive_end_is_recorded_and_excluded(self):
        class Column:
            def items(self):
                return [(dt.datetime(2025, 12, 31, tzinfo=dt.timezone.utc), 1.2),
                        (dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc), 1.3)]
        class Frame:
            empty = False
            index = type("Index", (), {"tz": dt.timezone.utc})()
            def __contains__(self, name):
                return name == "Close"
            def __getitem__(self, name):
                return Column()
        class Ticker:
            def history(self, **kwargs):
                return Frame()
            def get_history_metadata(self):
                return {"currency": "USD", "exchangeTimezoneName": "Europe/London"}
        provider = H.YahooProvider.__new__(H.YahooProvider)
        provider.cache = {}
        provider.yf = type("YF", (), {"Ticker": staticmethod(lambda _: Ticker()), "__version__": "test"})()
        result = provider.series("EURUSD=X", "2025-12-31", "2026-01-01")
        self.assertEqual(result["closes"], {"2025-12-31": 1.2})
        self.assertEqual(result["excluded_boundary_dates"], ["2026-01-01"])
        with self.assertRaisesRegex(H.HistoryError, "out-of-range"):
            provider.series("TEST", "2025-12-31", "2026-01-01")


if __name__ == "__main__":
    unittest.main(verbosity=2)

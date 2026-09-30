"""Daily Yahoo Close -> validated EUR history. Run from any working directory.

Agents write small control requests. The hook owns fetching; update_prices.py
owns commits. No model copies prices, and the current Scalable CSVs stay intact.
"""
from __future__ import annotations

import argparse
import bisect
import contextlib
import csv
import datetime as dt
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
HISTORY_END = "2026-01-01"  # exclusive: the user retained all recent Scalable prices
RUN_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$")
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9^.=-]+$")
FX = {"USD": ("EURUSD=X", 1), "GBP": ("EURGBP=X", 1),
      "GBp": ("EURGBP=X", .01), "CAD": ("EURCAD=X", 1),
      "DKK": ("EURDKK=X", 1), "CHF": ("EURCHF=X", 1),
      "JPY": ("EURJPY=X", 1), "HKD": ("EURHKD=X", 1),
      "AUD": ("EURAUD=X", 1)}
SOURCE_FIELDS = ["date", "isin", "symbol", "close", "currency", "close_eur",
                 "fx_symbol", "fx_date", "fx_close", "source"]
TRACKED = ["data/prices_daily.csv", "data/prices_history.csv",
           "data/yfinance_sources.csv", "data/yfinance_symbols.csv"]
PROTECTED = ["data/prices_daily.csv", "data/positions.csv", "data/benchmarks.csv",
             "data/instruments.csv", "data/depot.csv", "data/depot_ref.csv",
             "data/depot_transactions.csv", "data/intraday.csv", "data/intraday_2h.csv"]


class HistoryError(ValueError):
    pass


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic_bytes(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def save_json(path, data):
    atomic_bytes(path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def csv_bytes(fields, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def read_csv(path):
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        rows = list(reader)
    if len(set(fields)) != len(fields) or any(None in r or None in r.values() for r in rows):
        raise HistoryError(f"Malformed CSV: {path}")
    return fields, rows


def iso_date(value):
    parsed = dt.date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise HistoryError(f"Expected YYYY-MM-DD, got {value!r}")
    return parsed


def positive(value):
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise HistoryError(f"Invalid close: {value!r}")
    return result


def close_rows(path, start=None, end=None):
    fields, rows = read_csv(path)
    if fields != ["date", "close"]:
        raise HistoryError(f"Expected date,close: {path}")
    result, previous = {}, ""
    for r in rows:
        day = iso_date(r["date"])
        if day.weekday() > 4 or r["date"] <= previous:
            raise HistoryError(f"Dates must be unique ascending weekdays: {path}: {r['date']}")
        if (start and r["date"] < start) or (end and r["date"] >= end):
            raise HistoryError(f"Close outside requested interval: {path}: {r['date']}")
        result[r["date"]] = positive(r["close"])
        previous = r["date"]
    return result


@contextlib.contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise HistoryError(f"Another operation owns {path}; check its process before removing a stale lock") from exc
    try:
        os.write(fd, f"pid={os.getpid()}\n".encode())
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def run_dir(root, run_id):
    if not isinstance(run_id, str) or not RUN_RE.fullmatch(run_id):
        raise HistoryError("Invalid run ID")
    return root / "data/yfinance/runs" / run_id


def load_plan(root, run_id):
    directory = run_dir(root, run_id)
    plan = read_json(directory / "plan.json")
    if plan.get("version") != 1 or plan.get("run_id") != run_id:
        raise HistoryError("Invalid plan")
    return directory, plan


def seed_registry(root, batch_paths):
    """Merge disjoint agent receipts, never rediscover instruments here."""
    _, instruments = read_csv(root / "data/instruments.csv")
    by_isin = {}
    for path in batch_paths:
        for row in read_json(Path(path)):
            isin = row["isin"]
            if isin in by_isin:
                raise HistoryError(f"Overlapping agent ownership: {isin}")
            by_isin[isin] = row
    if set(by_isin) != {r["isin"] for r in instruments}:
        raise HistoryError("Agent mappings must cover exactly instruments.csv")
    fields = ["isin", "symbol", "currency", "enabled", "identity_status", "evidence_file", "fetched_at_utc", "reason"]
    rows = []
    for instrument in instruments:
        r = by_isin[instrument["isin"]]
        row = {f: r.get(f) or "" for f in fields}
        row["enabled"] = "1" if r.get("enabled") else "0"
        rows.append(row)
    atomic_bytes(root / "data/yfinance_symbols.csv", csv_bytes(fields, rows))
    return {"status": "registered", "instruments": len(rows), "enabled": sum(r["enabled"] == "1" for r in rows)}


def plan_history(root, isins=None, start="2016-09-30", end=None, policy="native", batch_size=10, use_audit=False):
    header, daily = read_csv(root / "data/prices_daily.csv")
    if header[:3] != ["date", "status", "asof_utc"] or not daily:
        raise HistoryError("Unexpected dashboard daily CSV contract")
    cutoff = min(HISTORY_END, daily[0]["date"])
    end = end or cutoff
    if not iso_date(start) < iso_date(end) or end > cutoff:
        raise HistoryError("This pipeline imports history strictly before 2026 and the Scalable daily database")
    if policy not in ("native", "fx") or not 1 <= batch_size <= 50:
        raise HistoryError("Invalid currency policy or batch size")
    _, registry = read_csv(root / "data/yfinance_symbols.csv")
    mapping = {r["isin"]: r for r in registry}
    if len(mapping) != len(registry) or set(mapping) != set(header[3:]):
        raise HistoryError("Symbol registry must cover every existing price column exactly once")
    requested = list(dict.fromkeys(isins or header[3:]))
    unknown = set(requested) - set(mapping)
    if unknown:
        raise HistoryError("Unknown ISINs: " + ",".join(sorted(unknown)))
    entries, skipped = [], []
    for isin in requested:
        row = mapping[isin]
        reason = row.get("reason", "")
        if row["enabled"] != "1":
            skipped.append({"isin": isin, "reason": reason or "mapping disabled"})
            continue
        if not ISIN_RE.fullmatch(isin) or not SYMBOL_RE.fullmatch(row["symbol"]):
            raise HistoryError(f"Invalid mapping for {isin}")
        if row["identity_status"] not in ("reverse_isin_matches", "isin_search_hit_unverified"):
            raise HistoryError(f"Unsupported identity evidence for {isin}")
        if policy == "native" and row["currency"] != "EUR":
            skipped.append({"isin": isin, "reason": f"native-EUR policy excludes {row['currency']}"})
            continue
        if row["currency"] != "EUR" and row["currency"] not in FX:
            raise HistoryError(f"Unsupported currency {row['currency']}")
        entries.append({k: row[k] for k in ("isin", "symbol", "currency", "identity_status")})
    if not entries:
        raise HistoryError("No eligible instruments in this selection")
    last_final = max(r["date"] for r in daily if r["status"] == "final")
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    directory = run_dir(root, run_id)
    plan = {"version": 1, "run_id": run_id, "start": start, "end": end,
            "fetch_end": (iso_date(last_final) + dt.timedelta(days=1)).isoformat(),
            "currency_policy": policy, "provider": "audit" if use_audit else "live", "entries": entries, "skipped": skipped,
            "batches": [entries[i:i + batch_size] for i in range(0, len(entries), batch_size)],
            "base_hashes": {name: digest(root / name) for name in TRACKED},
            "protected_hashes": {name: digest(root / name) for name in PROTECTED}}
    save_json(directory / "plan.json", plan)
    prompts = []
    for n, batch in enumerate(plan["batches"], 1):
        request = {"run_id": run_id, "batch": n, "plan_sha256": digest(directory / "plan.json")}
        file = root / "data/yfinance/requests" / f"{run_id}--{n}.json"
        prompts.append({"batch": n, "isins": [r["isin"] for r in batch],
                        "request_file": str(file), "request": request,
                        "instruction": "Use GPT-6 Luna high. Write exactly this control JSON with the Write tool. "
                        "The fetch-yfinance hook saves daily closes; do not copy prices or merge files. "
                        "If the receipt says NOT SAVED, report it. If no receipt appears, use the documented trigger command."})
    save_json(directory / "agent-prompts.json", prompts)
    return {"status": "planned", "run_id": run_id, "selected": len(entries), "skipped": skipped,
            "batches": len(prompts), "prompts_file": str(directory / "agent-prompts.json")}


class YahooProvider:
    def __init__(self, root):
        import yfinance as yf
        self.yf = yf
        self.cache = {}
        yf.set_tz_cache_location(str(root / "data/yfinance/cache"))
        logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    def identity(self, isin, symbol):
        quotes = self.yf.Search(isin, max_results=10, news_count=0, lists_count=0,
                                recommended=0, enable_fuzzy_query=False, timeout=15).quotes
        if symbol not in {q.get("symbol") for q in quotes}:
            raise HistoryError(f"{isin}: Yahoo exact-ISIN search no longer supports {symbol}")
        return "current_exact_isin_search_hit"

    def series(self, symbol, start, end):
        key = (symbol, start, end)
        if key in self.cache:
            return self.cache[key]
        ticker = self.yf.Ticker(symbol)
        frame = ticker.history(start=start, end=end, interval="1d", auto_adjust=False,
                               back_adjust=False, actions=False, repair=False, keepna=True,
                               rounding=False, timeout=15, raise_errors=True)
        if frame.empty or "Close" not in frame or frame.index.tz is None:
            raise HistoryError(f"{symbol}: no timezone-aware daily Close data")
        meta = ticker.get_history_metadata()
        if not meta.get("currency") or not meta.get("exchangeTimezoneName"):
            raise HistoryError(f"{symbol}: missing currency/timezone metadata")
        closes, missing, excluded_boundary_dates = {}, [], []
        for stamp, raw in frame["Close"].items():
            day = stamp.date().isoformat()  # exchange-local date, never shifted to UTC
            if not start <= day < end:
                # Yahoo can append today's live FX row at the exclusive end.
                # Discard and record it; never use an unfinished/end-date rate.
                if symbol in {item[0] for item in FX.values()} and day == end:
                    excluded_boundary_dates.append(day)
                    continue
                raise HistoryError(f"{symbol}: Yahoo returned an out-of-range date {day}")
            if math.isnan(float(raw)):
                missing.append(day)
                continue
            value = positive(raw)
            if iso_date(day).weekday() > 4 or day in closes:
                raise HistoryError(f"{symbol}: duplicate/weekend quote {day}")
            closes[day] = value
        if not closes:
            raise HistoryError(f"{symbol}: all closes unavailable")
        result = {"currency": meta["currency"], "timezone": meta["exchangeTimezoneName"],
                  "exchange": meta.get("exchangeName"), "closes": closes, "missing_dates": missing,
                  "excluded_boundary_dates": excluded_boundary_dates,
                  "yfinance_version": self.yf.__version__}
        self.cache[key] = result
        return result


class AuditProvider:
    """Reuse the audited yfinance fetch only while it is less than 24 hours old.

    Stock data keeps its original fetch timestamp and source-file digest. FX is
    fetched live through yfinance. Old audit files never masquerade as new data.
    """
    def __init__(self, root):
        self.root = root
        self.live = None
        self.by_symbol = {}
        self.by_isin = {}
        _, mapping = read_csv(root / "data/yfinance_symbols.csv")
        for row in mapping:
            if row["enabled"] != "1":
                continue
            audit_path = root / ".yfinance-probe/results" / f"{row['isin']}.json"
            audit = read_json(audit_path)
            self.by_isin[row["isin"]] = audit
            self.by_symbol[row["symbol"]] = audit

    def fresh(self, audit):
        fetched = dt.datetime.fromisoformat(audit["fetched_at_utc"].replace("Z", "+00:00"))
        if fetched.tzinfo is None:
            raise HistoryError("Audit has no timestamp timezone")
        age = dt.datetime.now(dt.timezone.utc) - fetched
        if age < dt.timedelta(minutes=-5) or age > dt.timedelta(hours=24):
            raise HistoryError("Audit is not current (24-hour limit); plan a live fetch")

    def identity(self, isin, symbol):
        audit = self.by_isin[isin]
        self.fresh(audit)
        if (audit.get("isin") != isin or audit.get("identity_status") == "reverse_isin_mismatch"
                or symbol not in {q.get("symbol") for q in audit.get("isin_search_quotes", [])}):
            raise HistoryError(f"{isin}: cached audit does not support {symbol}")
        return "cached_exact_isin_search_hit; " + audit["fetched_at_utc"]

    def series(self, symbol, start, end):
        if symbol not in self.by_symbol:
            self.live = self.live or YahooProvider(self.root)
            return self.live.series(symbol, start, end)
        audit = self.by_symbol[symbol]
        self.fresh(audit)
        history = next(h for h in audit["histories"] if h.get("symbol") == symbol and h.get("status") == "ok")
        raw_path = (self.root / history["file"]).resolve()
        if not raw_path.is_relative_to((self.root / ".yfinance-probe/raw").resolve()):
            raise HistoryError("Audit source file is outside the raw audit directory")
        fields, rows = read_csv(raw_path)
        if "Date" not in fields or "Close" not in fields:
            raise HistoryError("Audit source has no Date/Close columns")
        closes, missing = {}, []
        for row in rows:
            stamp = dt.datetime.fromisoformat(row["Date"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise HistoryError("Audit source dates have no timezone")
            day = stamp.date().isoformat()
            if not start <= day < end:
                continue
            if row["Close"].strip().lower() in ("", "nan"):
                missing.append(day)
                continue
            value = positive(row["Close"])
            if iso_date(day).weekday() > 4 or day in closes:
                raise HistoryError(f"{symbol}: duplicate/weekend audited close")
            closes[day] = value
        if not closes or not history.get("timezone"):
            raise HistoryError(f"{symbol}: no usable audited closes/timezone")
        return {"currency": history["currency"], "timezone": history["timezone"],
                "exchange": history.get("exchange"), "closes": closes, "missing_dates": missing,
                "yfinance_version": audit["yfinance_version"], "source_type": "cached_yfinance_audit",
                "source_fetched_at_utc": audit["fetched_at_utc"],
                "source_file": history["file"], "source_sha256": digest(raw_path)}


def retry(call, attempts=3):
    last = None
    for attempt in range(attempts):
        try:
            return call()
        except Exception as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(min(2 ** attempt, 4))
    raise HistoryError(str(last)) from last


def eur_close(day, close, currency, fx_closes):
    if currency == "EUR":
        return close, "", day, 1.0
    symbol, scale = FX[currency]
    days = sorted(fx_closes)
    index = bisect.bisect_right(days, day) - 1
    if index < 0 or (iso_date(day) - iso_date(days[index])).days > 4:
        raise HistoryError(f"{day}: no {symbol} FX close on or up to four calendar days before the stock close")
    fx_day = days[index]
    rate = positive(fx_closes[fx_day])
    return close * scale / rate, symbol, fx_day, rate


def shared_fx_series(directory, plan, symbol, provider):
    """Fetch an immutable FX series once per run, shared by parallel batches."""
    stem = symbol.replace("=", "_")
    file = directory / "fx" / (stem + ".csv")
    metadata_file = directory / "fx" / (stem + ".json")
    lock_file = directory / "fx" / (stem + ".lock")
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 90
    while True:
        if metadata_file.exists():
            metadata = read_json(metadata_file)
            if metadata["plan_sha256"] != digest(directory / "plan.json") or metadata["sha256"] != digest(file):
                raise HistoryError(f"{symbol}: shared FX checksum/plan mismatch")
            start = (iso_date(plan["start"]) - dt.timedelta(days=4)).isoformat()
            return dict(metadata["source"], closes=close_rows(file, start, plan["fetch_end"]))
        try:
            fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise HistoryError(f"Timed out waiting for {symbol}; check the FX lock owner")
            time.sleep(.2)
            continue
        try:
            os.write(fd, f"pid={os.getpid()}\n".encode())
            os.close(fd)
            # Another worker may have published the series just before this lock.
            if metadata_file.exists():
                continue
            start = (iso_date(plan["start"]) - dt.timedelta(days=4)).isoformat()
            result = retry(lambda: provider.series(symbol, start, plan["fetch_end"]))
            atomic_bytes(file, csv_bytes(["date", "close"],
                         [{"date": day, "close": repr(value)} for day, value in sorted(result["closes"].items())]))
            save_json(metadata_file, {"plan_sha256": digest(directory / "plan.json"), "sha256": digest(file),
                                      "fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                                      "source": {k: v for k, v in result.items() if k != "closes"}})
            return result
        finally:
            lock_file.unlink(missing_ok=True)


def stage_one(root, directory, plan, entry, provider):
    isin, symbol, currency = entry["isin"], entry["symbol"], entry["currency"]
    identity = retry(lambda: provider.identity(isin, symbol))
    raw = retry(lambda: provider.series(symbol, plan["start"], plan["fetch_end"]))
    if raw["currency"] != currency:
        raise HistoryError(f"{isin}: currency changed: expected {currency}, got {raw['currency']}")
    fx = None
    if currency != "EUR":
        fx_symbol = FX[currency][0]
        fx = shared_fx_series(directory, plan, fx_symbol, provider)
        expected = "GBP" if currency == "GBp" else currency
        if fx["currency"] != expected:
            raise HistoryError(f"{isin}: FX quote currency is {fx['currency']}, expected {expected}")
    converted = {}
    for day, value in raw["closes"].items():
        converted[day] = eur_close(day, value, currency, fx["closes"] if fx else {})
    _, daily = read_csv(root / "data/prices_daily.csv")
    overlap = [(r["date"], abs(converted[r["date"]][0] / positive(r[isin]) - 1))
               for r in daily if r["status"] == "final" and r.get(isin) and r["date"] in converted][-10:]
    if len(overlap) < 3:
        raise HistoryError(f"{isin}: fewer than three current final Scalable closes to validate identity/scale")
    deviations = [value for _, value in overlap]
    if statistics.median(deviations) > .08 or max(deviations) > .25:
        raise HistoryError(f"{isin}: EUR overlap/scale check failed (median {statistics.median(deviations):.2%}, max {max(deviations):.2%})")
    rows = []
    for day in sorted(raw["closes"]):
        if not plan["start"] <= day < plan["end"]:
            continue
        eur, fx_symbol, fx_day, rate = converted[day]
        rows.append({"date": day, "isin": isin, "symbol": symbol, "close": repr(raw["closes"][day]),
                     "currency": currency, "close_eur": repr(eur), "fx_symbol": fx_symbol,
                     "fx_date": fx_day, "fx_close": repr(rate),
                     "source": "yfinance Close" + ("; reconstructed EUR using daily FX" if fx else "; native EUR")})
    if not rows:
        raise HistoryError(f"{isin}: no daily closes in the requested historical interval")
    native_path = directory / "native" / f"{isin}.csv"
    atomic_bytes(native_path, csv_bytes(["date", "close"], [{"date": r["date"], "close": r["close"]} for r in rows]))
    file = directory / "staged" / f"{isin}.csv"
    atomic_bytes(file, csv_bytes(SOURCE_FIELDS, rows))
    fx_file = None
    if fx:
        fx_file = directory / "fx" / (FX[currency][0].replace("=", "_") + ".csv")
    receipt = {"status": "saved", "isin": isin, "symbol": symbol, "currency": currency,
               "rows": len(rows), "first": rows[0]["date"], "last": rows[-1]["date"],
               "sha256": digest(file), "native_sha256": digest(native_path),
               "fx_file": str(fx_file.relative_to(directory)) if fx_file else None,
               "fx_sha256": digest(fx_file) if fx_file else None,
               "plan_sha256": digest(directory / "plan.json"), "identity": identity,
               "metadata": {k: v for k, v in raw.items() if k != "closes"},
               "overlap": {"days": len(overlap), "median_abs_difference": statistics.median(deviations), "max_abs_difference": max(deviations)},
               "fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat()}
    save_json(directory / "receipts" / f"{isin}.json", receipt)
    return receipt


def fetch_batch(root, run_id, batch_number, provider=None):
    directory, plan = load_plan(root, run_id)
    if not 1 <= batch_number <= len(plan["batches"]):
        raise HistoryError("Invalid batch number")
    with lock(directory / f"batch-{batch_number}.lock"):
        provider = provider or (AuditProvider(root) if plan.get("provider") == "audit" else YahooProvider(root))
        results, errors = [], []
        for entry in plan["batches"][batch_number - 1]:
            isin = entry["isin"]
            receipt_file = directory / "receipts" / f"{isin}.json"
            try:
                if receipt_file.exists():
                    receipt = read_json(receipt_file)
                    validate_staged(directory, plan, entry, receipt)
                else:
                    receipt = stage_one(root, directory, plan, entry, provider)
                results.append(receipt)
                print(f"SAVED {isin}: {receipt['rows']} daily closes", file=sys.stderr, flush=True)
            except Exception as exc:
                errors.append({"isin": isin, "error": str(exc)})
                print(f"NOT SAVED {isin}: {exc}", file=sys.stderr, flush=True)
        summary = {"status": "saved" if not errors else "failed", "run_id": run_id,
                   "batch": batch_number, "saved": len(results), "expected": len(plan["batches"][batch_number - 1]),
                   "rows": sum(r["rows"] for r in results), "errors": errors}
        save_json(directory / f"batch-{batch_number}.json", summary)
        return summary


def validate_staged(directory, plan, entry, receipt):
    isin = entry["isin"]
    file = directory / "staged" / f"{isin}.csv"
    native = directory / "native" / f"{isin}.csv"
    if (receipt.get("isin"), receipt.get("symbol"), receipt.get("currency")) != (isin, entry["symbol"], entry["currency"]):
        raise HistoryError(f"{isin}: receipt identity mismatch")
    if receipt.get("status") != "saved" or receipt.get("plan_sha256") != digest(directory / "plan.json"):
        raise HistoryError(f"{isin}: receipt belongs to another plan")
    if digest(file) != receipt.get("sha256") or digest(native) != receipt.get("native_sha256"):
        raise HistoryError(f"{isin}: staged file checksum mismatch")
    native_closes = close_rows(native, plan["start"], plan["end"])
    fx = {}
    if entry["currency"] != "EUR":
        fx_file = directory / "fx" / (FX[entry["currency"]][0].replace("=", "_") + ".csv")
        if digest(fx_file) != receipt.get("fx_sha256"):
            raise HistoryError(f"{isin}: FX file checksum mismatch")
        fx = close_rows(fx_file)
    fields, rows = read_csv(file)
    if fields != SOURCE_FIELDS or len(rows) != receipt.get("rows") or not rows:
        raise HistoryError(f"{isin}: staged schema/count mismatch")
    if [r["date"] for r in rows] != list(native_closes):
        raise HistoryError(f"{isin}: staged dates differ from native closes")
    for row in rows:
        day = row["date"]
        if (row["isin"], row["symbol"], row["currency"]) != (isin, entry["symbol"], entry["currency"]):
            raise HistoryError(f"{isin}: staged row identity mismatch")
        if positive(row["close"]) != native_closes[day]:
            raise HistoryError(f"{isin}: native Close changed")
        eur, symbol, fx_day, rate = eur_close(day, native_closes[day], entry["currency"], fx)
        if row["fx_symbol"] != symbol or row["fx_date"] != fx_day or positive(row["fx_close"]) != rate:
            raise HistoryError(f"{isin}: FX provenance mismatch")
        if not math.isclose(positive(row["close_eur"]), eur, rel_tol=1e-12):
            raise HistoryError(f"{isin}: incorrect EUR conversion")
    overlap = receipt.get("overlap", {})
    if (overlap.get("days", 0) < 3 or overlap.get("median_abs_difference", 1) > .08
            or overlap.get("max_abs_difference", 1) > .25):
        raise HistoryError(f"{isin}: missing or failed overlap validation")
    return rows


def verify_dashboard(root, directory):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    commands = [[sys.executable, "data/build_data.py"], ["node", "tests/engine.test.cjs"],
                [sys.executable, "tests/crosscheck.py"], ["node", "tests/crosscheck.cjs"]]
    results = []
    for index, command in enumerate(commands, 1):
        result = subprocess.run(command, cwd=root, env=env, capture_output=True,
                                encoding="utf-8", errors="replace", timeout=180)
        log = directory / "verification" / f"{index}.log"
        atomic_bytes(log, (result.stdout + "\n" + result.stderr).encode("utf-8"))
        if result.returncode:
            raise HistoryError(f"Dashboard check failed: {' '.join(command)}; see {log}")
        results.extend(line for line in result.stdout.splitlines()
                       if line.startswith(("engine tests:", "crosscheck:")))
    return results


def finalize(root, run_id, allow_partial=False, check_runner=None):
    directory, plan = load_plan(root, run_id)
    with lock(root / "data/yfinance/merge.lock"):
        committed = directory / "commit.json"
        if committed.exists():
            result = read_json(committed)
            # Rebuild timestamps and human-edited documentation do not change a
            # committed dataset. Idempotence is based on authoritative CSVs/state.
            if any(digest(root / name) != result["commit_hashes"][name]
                   for name in ("data/prices_history.csv", "data/yfinance_sources.csv", "data/yfinance_status.json")):
                raise HistoryError("This run was already applied; the database has changed since then")
            return dict(result, status="already_applied")
        if any(digest(root / name) != expected for name, expected in plan["base_hashes"].items()):
            raise HistoryError("Database/registry changed after planning; create a fresh plan")
        incoming, rejected = [], []
        for entry in plan["entries"]:
            try:
                receipt = read_json(directory / "receipts" / f"{entry['isin']}.json")
                incoming.extend(validate_staged(directory, plan, entry, receipt))
            except Exception as exc:
                rejected.append({"isin": entry["isin"], "reason": str(exc)})
        if rejected and not allow_partial:
            raise HistoryError("Incomplete/invalid batch; nothing merged: " + json.dumps(rejected))
        if not incoming:
            raise HistoryError("No validated daily closes to merge")
        daily_header, daily = read_csv(root / "data/prices_daily.csv")
        history_header, history = read_csv(root / "data/prices_history.csv")
        if history_header != ["date", "res"] + daily_header[3:]:
            raise HistoryError("History columns must match the daily price columns in order")
        history_by_day = {}
        for row in history:
            if (row["date"] in history_by_day or row["date"] >= min(HISTORY_END, daily[0]["date"])
                    or iso_date(row["date"]).weekday() > 4 or row["res"] not in ("d", "2d", "m")):
                raise HistoryError("Invalid existing history dates/resolution")
            history_by_day[row["date"]] = row
        source_header, sources = read_csv(root / "data/yfinance_sources.csv")
        if source_header and source_header != SOURCE_FIELDS:
            raise HistoryError("Unexpected Yahoo source ledger schema")
        ledger = {(r["date"], r["isin"]): r for r in sources}
        if len(ledger) != len(sources):
            raise HistoryError("Duplicate date/ISIN in Yahoo source ledger")
        changed = 0
        for row in incoming:
            if row["date"] >= min(HISTORY_END, daily[0]["date"]) or row["isin"] not in daily_header[3:]:
                raise HistoryError("Refusing to change recent data or add an unknown instrument")
            ledger[(row["date"], row["isin"])] = row
            target = history_by_day.setdefault(row["date"], dict.fromkeys(history_header, ""))
            target["date"] = row["date"]
            target["res"] = "d"  # daily observations exist on this date; other titles may retain sparse fallback
            if target[row["isin"]] != row["close_eur"]:
                changed += 1
            target[row["isin"]] = row["close_eur"]
        source_rows = [ledger[key] for key in sorted(ledger)]
        history_rows = [history_by_day[day] for day in sorted(history_by_day)]
        coverage = {isin: sum(r["isin"] == isin for r in source_rows) for isin in sorted({r["isin"] for r in source_rows})}
        status = {"run_id": run_id, "source": "Yahoo Finance via yfinance; Close, dividend adjustment disabled",
                  "currency_policy": plan["currency_policy"], "first": source_rows[0]["date"],
                  "last": source_rows[-1]["date"], "instruments": len(coverage), "rows": len(source_rows),
                  "coverage": coverage, "risk_daily_from": daily[0]["date"],
                  "skipped": plan["skipped"] + rejected, "fx_max_age_calendar_days": 4}
        names = ["data/prices_history.csv", "data/yfinance_sources.csv", "data/yfinance_status.json",
                 "data/portfolio-data.js", "tests/reference.json", "HANDOFF.md"]
        backup = {name: (root / name).read_bytes() if (root / name).exists() else None for name in names}
        for name, content in backup.items():
            if content is not None:
                atomic_bytes(directory / "backup" / name, content)
        save_json(directory / "backup-index.json", {name: value is not None for name, value in backup.items()})
        try:
            atomic_bytes(root / names[0], csv_bytes(history_header, history_rows))
            atomic_bytes(root / names[1], csv_bytes(SOURCE_FIELDS, source_rows))
            save_json(root / names[2], status)
            checks = (check_runner or verify_dashboard)(root, directory)
            if any(digest(root / name) != expected for name, expected in plan["protected_hashes"].items()):
                raise HistoryError("A protected current-price/holdings/intraday file changed during import")
            handoff_path = root / "HANDOFF.md"
            if handoff_path.exists():
                handoff = handoff_path.read_text(encoding="utf-8")
                resolution = "daily Yahoo closes plus sparse Scalable fallback"
                handoff = re.sub(r"history \(prices_history.csv\):.*?; ",
                                 f"history (prices_history.csv): {len(history_rows)} rows {history_rows[0]['date']} … {history_rows[-1]['date']} ({resolution}); ", handoff, count=1)
                for summary in checks:
                    if summary.startswith("engine tests:"):
                        handoff = re.sub(r"engine tests: [^;\n]+", summary, handoff, count=1)
                    elif summary.startswith("crosscheck:"):
                        handoff = re.sub(r"crosscheck: [^.\n]+", summary.rstrip('.'), handoff, count=1)
                block = ("<!-- yfinance-status:start -->\n"
                         f"- Yahoo history: {len(coverage)} instruments, {len(source_rows)} daily closes {status['first']} … {status['last']}. "
                         f"Policy {plan['currency_policy']}; 2026 Scalable daily/intraday data retained. "
                         f"Risk metrics still start at {daily[0]['date']} because remaining instruments have sparse history. "
                         f"Checks: {'; '.join(checks)}. Run {run_id}.\n<!-- yfinance-status:end -->")
                if "<!-- yfinance-status:start -->" in handoff:
                    handoff = re.sub(r"<!-- yfinance-status:start -->.*?<!-- yfinance-status:end -->", lambda _: block, handoff, flags=re.S)
                else:
                    handoff += "\n\n" + block + "\n"
                atomic_bytes(handoff_path, handoff.encode("utf-8"))
            result = {"status": "applied", "run_id": run_id, "imported_rows": len(incoming),
                      "changed_cells": changed, "total_source_rows": len(source_rows), "instruments": len(coverage),
                      "history_dates": len(history_rows), "skipped": plan["skipped"] + rejected,
                      "checks": checks, "commit_hashes": {name: digest(root / name) for name in names},
                      "protected_hashes": plan["protected_hashes"]}
            save_json(committed, result)
            return result
        except BaseException:
            for name, content in backup.items():
                if content is None:
                    (root / name).unlink(missing_ok=True)
                else:
                    atomic_bytes(root / name, content)
            raise


def restore_overlay(root):
    """Keep daily Yahoo observations when the legacy Scalable history is refreshed.

    Caller owns the shared merge lock. Use the ledger as the authoritative value
    for imported date/ISIN keys; retain every other Scalable fallback observation.
    """
    fields, sources = read_csv(root / "data/yfinance_sources.csv")
    if not sources:
        return
    if fields != SOURCE_FIELDS:
        raise HistoryError("Unexpected source ledger schema")
    daily_header, daily = read_csv(root / "data/prices_daily.csv")
    header, history = read_csv(root / "data/prices_history.csv")
    if header != ["date", "res"] + daily_header[3:]:
        raise HistoryError("Cannot overlay mismatched history columns")
    table = {r["date"]: r for r in history}
    keys = set()
    for row in sources:
        day, isin = row["date"], row["isin"]
        key = (day, isin)
        if key in keys or iso_date(day).weekday() > 4 or day >= min(HISTORY_END, daily[0]["date"]) or isin not in header[2:]:
            raise HistoryError("Invalid source ledger date/ISIN")
        keys.add(key)
        expected = eur_close(day, positive(row["close"]), row["currency"],
                             {row["fx_date"]: positive(row["fx_close"])} if row["currency"] != "EUR" else {})[0]
        if not math.isclose(positive(row["close_eur"]), expected, rel_tol=1e-12):
            raise HistoryError("Invalid ledger EUR conversion")
        target = table.setdefault(day, dict.fromkeys(header, ""))
        target.update({"date": day, "res": "d", isin: row["close_eur"]})
    atomic_bytes(root / "data/prices_history.csv", csv_bytes(header, [table[day] for day in sorted(table)]))


def trigger(root, run_id, batch_number):
    directory, plan = load_plan(root, run_id)
    if not 1 <= batch_number <= len(plan["batches"]):
        raise HistoryError("Invalid batch number")
    request_file = root / "data/yfinance/requests" / f"{run_id}--{batch_number}.json"
    save_json(request_file, {"run_id": run_id, "batch": batch_number,
                             "plan_sha256": digest(directory / "plan.json")})
    command = ["node", str(root / ".claude/hooks/fetch-yfinance.cjs"), "--request", str(request_file)]
    result = subprocess.run(command, cwd=root, capture_output=True, encoding="utf-8", errors="replace", timeout=1800)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode:
        raise HistoryError("Fetch hook failed: " + result.stdout.strip())
    return json.loads(result.stdout)


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    seed = sub.add_parser("seed-registry")
    seed.add_argument("mapping_files", nargs="+")
    for name in ("plan", "run"):
        child = sub.add_parser(name)
        child.add_argument("--isins", help="Comma-separated exact existing ISINs; default all eligible")
        child.add_argument("--start", default="2016-09-30")
        child.add_argument("--end", help="Exclusive; default first Scalable daily date")
        child.add_argument("--currency-policy", choices=("native", "fx"), required=True)
        child.add_argument("--batch-size", type=int, default=10)
        child.add_argument("--use-audit", action="store_true", help="Reuse today's audit with its original provenance; 24-hour limit")
        if name == "run":
            child.add_argument("--allow-partial", action="store_true")
    for name in ("fetch", "trigger", "finish"):
        child = sub.add_parser(name)
        child.add_argument("run_id")
        if name == "finish":
            child.add_argument("--allow-partial", action="store_true")
        else:
            child.add_argument("--batch", type=int, required=True)
    args = parser.parse_args()
    try:
        if args.command == "seed-registry":
            result = seed_registry(ROOT, args.mapping_files)
        elif args.command in ("plan", "run"):
            result = plan_history(ROOT, args.isins.split(",") if args.isins else None,
                                  args.start, args.end, args.currency_policy, args.batch_size, args.use_audit)
            if args.command == "run":
                for number in range(1, result["batches"] + 1):
                    trigger(ROOT, result["run_id"], number)
                result = finalize(ROOT, result["run_id"], args.allow_partial)
        elif args.command == "fetch":
            result = fetch_batch(ROOT, args.run_id, args.batch)
        elif args.command == "trigger":
            result = trigger(ROOT, args.run_id, args.batch)
        else:
            result = finalize(ROOT, args.run_id, args.allow_partial)
        print(json.dumps(result, ensure_ascii=False))
        return 1 if result.get("status") == "failed" else 0
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(cli())

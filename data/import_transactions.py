# Imports the Scalable broker transaction export into data/transactions.csv (the "Depot-Historie" benchmark, user 27.09.2026).
# Usage (from the repository root):  python data/import_transactions.py <ScalableCapital-Broker-Transactions.csv>
#                                     python data/build_data.py
# Input: the app's CSV export, ';'-separated, German numbers ("4.308" = 4308 shares, "6,099" = 6.099), newest first, columns
#   date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
# Output: only the executed security trades (status Executed, assetType Security, type Buy / Sell / Corporate action),
#   chronological, columns date,time,isin,name,type,shares,price with shares signed (+ in, - out). No references, no cash
#   rows, no fees, taxes or amounts. The raw export is never copied into the repository. Exit code 1 = nothing written.
import csv, pathlib, sys

D = pathlib.Path(__file__).resolve().parent
OUT = D / 'transactions.csv'
NEED = ['date', 'time', 'status', 'description', 'assetType', 'type', 'isin', 'shares', 'price', 'amount']
TYPES = ('Buy', 'Sell', 'Corporate action')


def de_num(s):
    """German number -> float: '4.308' -> 4308, '1.040,00' -> 1040, '6,099' -> 6.099, '-150' -> -150."""
    s = (s or '').strip().replace('.', '').replace(',', '.')
    return float(s) if s else None


def fmt(x):
    return str(int(x)) if x == int(x) else repr(x)


def main(path):
    src = pathlib.Path(path)
    with open(src, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f, delimiter=';'))
    missing = [c for c in NEED if rows and c not in rows[0]]
    if not rows or missing:
        print(f'ERROR: {src.name} is not a Scalable transaction export (missing columns: {", ".join(missing) or "all rows"})')
        return 1
    errors, warns, trades = [], [], []
    for n, r in enumerate(reversed(rows)):                 # the export is newest first; reversed + stable sort keeps same-time order
        if r['status'] != 'Executed' or r['assetType'] != 'Security': continue
        if r['type'] not in TYPES: warns.append(f"skipped {r['date']} {r['type']} {r['isin']}"); continue
        q, p, amt = de_num(r['shares']), de_num(r['price']), de_num(r['amount'])
        if q is None or p is None or not r['isin'] or len(r['date']) != 10:
            errors.append(f"unreadable row {r['date']} {r['time']} {r['isin']} shares={r['shares']!r} price={r['price']!r}"); continue
        if r['type'] == 'Buy': q = abs(q)
        elif r['type'] == 'Sell': q = -abs(q)
        if q == 0: continue
        if amt is not None and r['type'] != 'Corporate action' and abs(abs(amt) - abs(q) * p) > max(0.05, 0.005 * abs(amt)):
            warns.append(f"{r['date']} {r['isin']}: amount {amt:g} differs from shares x price {abs(q) * p:g}")
        trades.append({'date': r['date'], 'time': r['time'] or '00:00:00', 'isin': r['isin'], 'name': r['description'],
                       'type': r['type'], 'shares': q, 'price': p, 'n': n})
    trades.sort(key=lambda t: (t['date'], t['time'], t['n']))
    hold, neg = {}, []
    for t in trades:                                       # replay: holdings must never go negative
        hold[t['isin']] = round(hold.get(t['isin'], 0) + t['shares'], 9)
        if hold[t['isin']] < 0: neg.append(f"{t['date']} {t['isin']} {hold[t['isin']]:g}")
    if neg: warns.append('negative holdings (export incomplete?): ' + ', '.join(neg[:5]))
    if errors or not trades:
        print('ERRORS (nothing written):', *(errors or ['no executed security trades in the file']), sep='\n  ')
        return 1
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['date', 'time', 'isin', 'name', 'type', 'shares', 'price'])
        for t in trades: w.writerow([t['date'], t['time'], t['isin'], t['name'], t['type'], fmt(t['shares']), fmt(t['price'])])
    kinds = {k: sum(t['type'] == k for t in trades) for k in TYPES}
    end = {i: q for i, q in hold.items() if q}
    print(f"transactions.csv: {len(trades)} trades ({kinds['Buy']} buys, {kinds['Sell']} sells, {kinds['Corporate action']} corporate action(s)) "
          f"{trades[0]['date']} .. {trades[-1]['date']}, {len({t['isin'] for t in trades})} ISINs")
    print('end holdings: ' + ' | '.join(f'{i}:{fmt(q)}' for i, q in sorted(end.items())))
    if warns: print('WARNINGS:', *warns, sep='\n  ')
    print('next: python data/build_data.py (checks the prices of every held ISIN)')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('usage: python data/import_transactions.py <ScalableCapital-Broker-Transactions.csv>')
        sys.exit(2)
    sys.exit(main(sys.argv[1]))

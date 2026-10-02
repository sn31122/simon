# Grouped depot phases -> data/history_phases.csv (time-weighted average of the daily closing allocations)
import csv, sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
D=str(Path(__file__).resolve().parents[1])+'/'
def n(s):
    s=(s or '').strip(); return float(s.replace('.','').replace(',','.')) if s else 0.0
px={}
for f,skip in (('prices_history.csv',2),('prices_daily.csv',3)):
    r=csv.reader(open(D+f,encoding='utf-8')); h=next(r)
    for row in r: px.setdefault(row[0],{}).update({h[i]:float(v) for i,v in enumerate(row) if i>=skip and v})
dates=sorted(px)
cols=set(open(D+'prices_daily.csv').readline().strip().split(','))
tx=[r for r in csv.DictReader(open(D+'depot_transactions.csv',encoding='utf-8-sig'),delimiter=';')
    if r['status']=='Executed' and r['assetType']=='Security' and r['type'] in('Buy','Sell','Corporate action')]
tx.sort(key=lambda r:(r['date'],r['time']))
PROXY={'DE000GX6ZLS7':'IE00BF01VY89'}
def price(i,d):
    for x in reversed([x for x in dates if x<=d]):
        if i in px[x]: return px[x][i]
fac={i:sum(n(r['price'])/price(p,r['date']) for r in tx if r['isin']==i)/sum(1 for r in tx if r['isin']==i) for i,p in PROXY.items()}
PH=[('Aufbau All-World','2025-12-08','2026-02-12'),('Einstieg USA 2x','2026-02-13','2026-03-06'),
    ('USA 2x dominant','2026-03-09','2026-03-26'),('USA 2x + NVIDIA','2026-03-27','2026-04-16'),
    ('Big Tech + USA 2x','2026-04-17','2026-07-17'),('Wechsel Nasdaq 2x','2026-07-20','2026-08-17'),
    ('Nasdaq 2x + Alphabet-Hebel','2026-08-18','2026-09-08'),('Alphabet 3x führt','2026-09-09','2026-09-28'),
    ('Alphabet 3x + Coherent','2026-09-29','2026-10-01')]
hold={}; k=0; daily={}
for d in [x for x in dates if '2025-12-01'<=x<='2026-10-01']:
    while k<len(tx) and tx[k]['date']<=d:
        r=tx[k]; k+=1; q=n(r['shares']); q=q if r['type']=='Buy' else -abs(q)
        hold[r['isin']]=hold.get(r['isin'],0)+q
        if abs(hold[r['isin']])<1e-6: del hold[r['isin']]
    v={}
    for i,q in hold.items():
        if i in PROXY: v[PROXY[i]]=v.get(PROXY[i],0)+q*fac[i]*price(PROXY[i],d)
        elif i in cols and price(i,d): v[i]=v.get(i,0)+q*price(i,d)
    t=sum(v.values()); daily[d]={i:x/t*100 for i,x in v.items()}
rows=[]
for name,a,b in PH:
    ds=[d for d in daily if a<=d<=b]; avg={}
    for d in ds:
        for i,p in daily[d].items(): avg[i]=avg.get(i,0)+p/len(ds)
    w={i:p for i,p in avg.items() if p>=1}; t=sum(w.values())
    w={i:round(p/t*100,1) for i,p in sorted(w.items(),key=lambda x:-x[1])}
    top=max(w,key=w.get); w[top]=round(w[top]+100-sum(w.values()),1)
    nm=f"{name} ({a[8:10]}.{a[5:7]}.{a[2:4]})"
    rows.append({'id':'h'+a.replace('-',''),'name':nm,'from':a,'to':b,'holdings':'|'.join(f'{i}:{p:g}%' for i,p in w.items()),
                 'description':f'Echtes Depot {a} … {b}: zeitgewichteter Durchschnitt der Tagesschluss-Gewichte über {len(ds)} Handelstage (Positionen < 1 % weggelassen)'})
    print(nm,len(ds),w)
with open(D+'history_phases.csv','w',newline='',encoding='utf-8') as f:
    wr=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n'); wr.writeheader(); wr.writerows(rows)

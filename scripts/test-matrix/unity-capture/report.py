#!/usr/bin/env python3
"""Summarise a capture matrix report: counts by outcome, then failures (or every config with `all`)."""
import json, sys, collections
r=json.load(open(sys.argv[1], encoding='utf-8-sig'))
print({k:r[k] for k in ('platform','graphicsApi','uvStartsAtTop','unity','total','passed','failed','fatal')})
c=collections.Counter()
for x in r['results']:
    key=(x.get('source'), x.get('verdict'), x.get('world'), x.get('ui'), x.get('mask'), x.get('overlay'), x.get('shape'), (x.get('layout') or '')[:60], tuple(e[:90] for e in x.get('errors',[]))[:1])
    c[key]+=1
for k,v in sorted(c.items(), key=lambda kv: str(kv[0])): print(v, k)
if len(sys.argv)>2:
    for x in r['results']:
        if sys.argv[2]=='all' or not x['pass']: print(x['config'].ljust(52), x.get('source'), x.get('verdict'), 'world='+str(x.get('world')), 'ui='+str(x.get('ui')), 'mask='+str(x.get('mask')), 'ov='+str(x.get('overlay')), x.get('samples'), (x.get('errors') or [''])[0][:80])

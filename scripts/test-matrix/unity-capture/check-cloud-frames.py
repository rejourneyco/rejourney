#!/usr/bin/env python3
"""Check the stored frames of a capture matrix session (dump-production-session.sh output).

Every frame must show the lab's markers upright and the masked box as the mask's grey.
Frames caught while the lab re-lays out its quads after a rotation show black on the
left half with the UI and mask correct; they are listed, not hidden. Needs Pillow.
"""
import json, base64, io, sys, collections
from PIL import Image
frames=[]; events=[]; dev=None
for line in open(sys.argv[1]):
    try: o=json.loads(line)
    except Exception: continue
    if o['kind']=='frame': frames.append(o)
    elif o['kind']=='events': events += o.get('events') or []; dev = dev or o.get('deviceInfo')
def cls(c):
    r,g,b=[x/255 for x in c]
    if r>.75 and g>.75 and b>.75: return 'white'
    if r>.5 and g<.35 and b<.35: return 'red'
    if b>.5 and r<.35 and g<.35: return 'blue'
    if g>.5 and r<.35 and b<.35: return 'green'
    if r>.5 and g>.5 and b<.35: return 'yellow'
    if r>.5 and b>.5 and g<.35: return 'magenta'
    if r<.04 and g<.04 and b<.04: return 'black'
    if .05<r<.3 and abs(r-g)<.04 and abs(r-b)<.04: return 'grey'
    return 'rgb%s'%(c,)
cfg=sorted([(e['timestamp'], json.loads(e['payload'])) for e in events if e.get('type')=='custom' and e.get('name')=='matrix_config'], key=lambda x:x[0])
print('device', {k:dev.get(k) for k in ('platform','model','osVersion','graphicsApi','unityVersion','sdkVersion')} if dev else None)
print('frames', len(frames), 'configs', len(cfg))
res=collections.Counter(); bad=[]
for f in sorted(frames, key=lambda f:f['ts']):
    im=Image.open(io.BytesIO(base64.b64decode(f['b64']))).convert('RGB'); w,h=im.size
    def at(x,y):
        px=min(max(int(x*w),2),w-3); py=min(max(int(y*h),2),h-3)
        box=im.crop((px-2,py-2,px+3,py+3)); d=list(box.getdata()); return cls(tuple(sum(p[i] for p in d)//len(d) for i in range(3)))
    tl,bl,tr,br,sec,mir=at(.3,.3),at(.3,.7),at(.7,.3),at(.7,.7),at(.875,.125),at(.875,.875)
    ok = tl=='red' and bl=='blue' and tr=='green' and br=='yellow' and sec=='grey' and mir=='yellow'
    res['ok' if ok else 'BAD']+=1
    if not ok:
        name=None
        for ts,p in cfg:
            if ts>=f['ts']: name=p.get('name'); break
        bad.append((f['off'], (w,h), tl,bl,tr,br,sec,mir, name))
print(dict(res))
for b in bad[:25]: print(b)

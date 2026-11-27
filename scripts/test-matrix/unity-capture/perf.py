#!/usr/bin/env python3
"""Print a performance lab report (perf-report.json) as a table, one row per case."""
import json, sys
r=json.load(open(sys.argv[1], encoding='utf-8-sig'))
print({k:r[k] for k in ('platform','graphicsApi','unity','device','screen','native','debugBuild')})
cols=['case','fps','frameP50','frameP95','frameP99','frameMax','cpuP50','cpuP95','gcBytesPerFrame','gcBytesPerSecond','gcCollections','sdkMainThreadMsPerSecond','framesCaptured','jpegBytesPerFrame','lastCaptureMs','systemMemoryMb','gfxMemoryMb','gcUsedMb','totalUsedMb','skippedBackpressure','captureFailures','eventsDropped']
short=['case','fps','f50','f95','f99','fmax','cpu50','cpu95','gc/frame','gc/s','gcs','sdk ms/s','frames','jpegB','capMs','sysMB','gfxMB','gcMB','totMB','bp','fail','drop']
rows=[[str(x.get(c)) for c in cols] for x in r['results']]
w=[max(len(short[i]), *(len(row[i]) for row in rows)) for i in range(len(cols))]
print('  '.join(short[i].ljust(w[i]) for i in range(len(cols))))
for row in rows: print('  '.join(row[i].ljust(w[i]) for i in range(len(cols))))

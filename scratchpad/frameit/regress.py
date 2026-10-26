import glob, numpy as np
from PIL import Image
D = '/home/jho4255/ArtLink/scratchpad/frameit/'
rows = {}
for f in sorted(glob.glob(D + 'png/*_base.png')):
    a = np.asarray(Image.open(f).convert('RGB')).astype(int); b = np.asarray(Image.open(f.replace('_base.png', '_now.png')).convert('RGB')).astype(int)
    d = np.abs(a - b); rows[f.split('/')[-1][:-9]] = (d.max(), (d.max(axis=2) > 0).mean() * 100)
ch = [(k, v) for k, v in rows.items() if v[0] > 0]
print('비교', len(rows), '· 바뀐 것', len(ch))
by = {}
for k, (m, p) in ch: by.setdefault(k.split('_', 2)[2], []).append((m, p))
for fid, l in sorted(by.items()): print(f'{fid:22s} {len(l)}건  최대 {max(x[0] for x in l)}  면적 최대 {max(x[1] for x in l):.2f}%')

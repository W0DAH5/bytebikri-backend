"""Model-free: are the figure's interior two-level patches arranged in ~21px runs
(= the page's checker square) or irregular (noise)?"""
import numpy as np
from PIL import Image
C="app/public/img/cosmetics"
master=np.asarray(Image.open(f"{C}/mascot-gold-buddha-base.png").convert("RGB")).astype(np.float32)
g=master.mean(axis=2)
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
def runs_of(mask_2d, min_len=8, max_len=60):
    out=[]
    for row in mask_2d:
        idx=np.nonzero(np.diff(row))[0]
        bounds=np.concatenate(([0],idx,[len(row)-1]))
        out.extend((bounds[1:]-bounds[:-1]).tolist())
    r=np.array(out); return r[(r>=min_len)&(r<=max_len)]
# page runs (baseline): rows fully page
full=np.nonzero((~MATTE).all(axis=1))[0]
page_runs=runs_of(g[full[::3]][~MATTE[full[::3]]].reshape(len(full[::3]),-1)>247.5 if False else (~MATTE[full[::3]])*0)
page_runs=[]
for y in full[::2]:
    lv=(g[y]>247.5); lv=lv[~MATTE[y]]
    page_runs.extend(runs_of(lv.reshape(1,-1)).tolist())
page_runs=np.array(page_runs)
print(f"PAGE runs: n={len(page_runs)} median {np.median(page_runs):.1f}  IQR {np.percentile(page_runs,25):.0f}-{np.percentile(page_runs,75):.0f}")
# the grape-bunch interior: master figure px that are two-level pale
two=((np.abs(g-241.5)<=3)|(np.abs(g-253.5)<=3))
inter=MATTE&two
# focus: the bunch bbox found earlier (cell 1,5) x 640..768 y 128..256
X0,Y0,X1,Y1=640,128,780,256
sub=inter[Y0:Y1,X0:X1]
int_runs=runs_of(sub)
print(f"BUNCH-interior runs: n={len(int_runs)} median {np.median(int_runs):.1f}  IQR {np.percentile(int_runs,25):.0f}-{np.percentile(int_runs,75):.0f}")
# control 1: same area's page runs (strip above bunch: y 0..60)
ctrl=(~MATTE[Y0-128:Y0,X0:X1]) if Y0>=128 else None
ctrl_runs=runs_of((~MATTE[0:60,X0:X1]))
print(f"page-same-x runs: n={len(ctrl_runs)} median {np.median(ctrl_runs):.1f}")
# control 2: master's own specular flats area (e.g. the bright chest sheen x 560..660 y 240..340) - two-level px there?
sp=MATTE[240:340,560:660]&two[240:340,560:660]
print(f"chest-sheen area two-level px: {int(sp.sum())} (should be ~0 if those flats are pure white, not two-level)")

import numpy as np
from PIL import Image, ImageFilter
C="app/public/img/cosmetics"; E="docs/evidence/round56"; P=f"{E}/keyform-package"
master=np.asarray(Image.open(f"{C}/mascot-gold-buddha-base.png").convert("RGB")).astype(np.float32)
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
g=master.mean(axis=2)
grayish=(np.abs(master[...,0]-master[...,1])<=10)&(np.abs(master[...,1]-master[...,2])<=10)&(np.abs(master[...,0]-master[...,2])<=10)
level=(np.abs(g-241.5)<=3)|(np.abs(g-253.5)<=3)
k=3
def box(a):
    w=2*k+1
    p=np.pad(a,k,mode='edge')
    c=np.cumsum(np.cumsum(p,0),1)
    c=np.pad(c,((1,0),(1,0)))
    return c[w:,w:]-c[:-w,w:]-c[w:,:-w]+c[:-w,:-w]
std=np.sqrt(np.maximum(box(g*g)-box(g)**2,0))
strict=MATTE&grayish&level&(std<2.0)
# subtract the master's own specular flats: those are pure white 255 flats, checker is 241/253 alternating.
# discrimininate by LOCAL contrast inside the flat: checker alternates two levels ~12 apart
lum247=(g>=238)&(g<=257)
alt = (box((g>247).astype(np.float32))>0.15)&(box((g<=247).astype(np.float32))>0.15)
checkerish=strict&alt
print(f"master figure px passing strict flat-gray: {int(strict.sum()):,}")
print(f"  of which two-level alternating (checker-like): {int(checkerish.sum()):,}")
holes=np.zeros(MATTE.shape,bool)
for rid in ("R01","R02","R03","R04","R05"):
    holes|=np.load(f"{P}/{rid}-mask.npy")
print(f"  inside the package's holes: {int((checkerish&holes).sum()):,}")
print(f"  outside the holes (rest-visible, latent-in-plain-sight): {int((checkerish&~holes).sum())}")
ys,xs=np.nonzero(checkerish)
from collections import Counter
c=Counter(zip((ys//128).tolist(),(xs//128).tolist()))
print("  128px cells:", c.most_common(6))
# amplification: changed pale px in the opening at each pose vs rest (R01 crop area)
X0,Y0,X1,Y1=560,0,900,360
rest_im=np.asarray(Image.open(f"{E}/06-pose-+0.png").convert("RGB")).astype(int)
m=(np.abs(np.asarray(Image.open(f"{E}/06-pose-{p}").convert("RGB")).astype(int)-rest_im).max(axis=2)>8) if False else None
for p in ("-3","-7","-15"):
    im=np.asarray(Image.open(f"{E}/06-pose-{p}.png").convert("RGB")).astype(int)
    a=np.asarray(Image.open(f"{E}/06-pose-{p}-alpha.png").getchannel("A"))>127
    mag=(im[...,0]>200)&(im[...,2]>200)&(im[...,1]<80)
    mx=im.max(axis=2); mn=im.min(axis=2)
    pale=(mn>170)&((mx-mn)<40)&~mag
    ch=(np.abs(im-rest_im).max(axis=2)>8)
    amp=int((pale&ch&a)[Y0:Y1,X0:X1].sum())
    print(f"  {p}: changed pale-on-figure px in the R01 opening crop: {amp:,}")
np.save("/tmp/master-checker.npy", checkerish)

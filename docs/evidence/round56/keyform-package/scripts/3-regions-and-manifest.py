"""Build the painter package: per-region masks, stats, pose exposure, templates,
overview sheet, manifest. Stated rule, fixed solver, recorded cross-references."""
import numpy as np, importlib.util, json, os
from PIL import Image, ImageDraw
spec=importlib.util.spec_from_file_location("hv","app/scripts/holdout-validation.py")
hv=importlib.util.module_from_spec(spec); spec.loader.exec_module(hv)
src=open("app/scripts/buddha-rig-art.py").read()
ns={"np":np,"Image":Image,"ImageFilter":__import__("PIL.ImageFilter",fromlist=["ImageFilter"])}
for a,b in (("_dil","_ero"),("_ero","_rotated"),("_rotated","_kept")):
    i=src.index(f"\ndef {a}(")+1; j=src.index(f"\ndef {b}(")
    exec(compile(src[i:j].rstrip()+"\n",f"<p:{a}>","exec"),ns)
_dil=ns["_dil"]
C="app/public/img/cosmetics"; R=f"{C}/rig"; E="docs/evidence/round56"
os.makedirs(f"{E}/keyform-package", exist_ok=True)
master=Image.open(f"{C}/mascot-gold-buddha-base.png").convert("RGB")
rgb=np.asarray(master).astype(np.float32)
L=hv.lum(rgb)
grown=np.load("/tmp/art_grown.npy"); field=np.load("/tmp/art_field.npy")
GRA=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
poses={}   # name -> exposure mask (rest-covered & not covered)
rest=np.asarray(Image.open(f"{E}/06-pose-+0-alpha.png").getchannel("A"))>127
for p in ("+6","-3","-7","-15"):
    poses[f"arm {p}"] = rest & ~(np.asarray(Image.open(f"{E}/06-pose-{p}-alpha.png").getchannel("A"))>127)
poses["grapes -4.5"] = GRA & ~(ns["_rotated"](GRA,-4.5,(740.0,90.0)))
poses["grapes +4.0"] = GRA & ~(ns["_rotated"](GRA, 4.0,(740.0,90.0)))
# ── classes: stated rule on the FIXED field ──
SKY = grown & (field <= 0.2)
BODY= grown & (field >= 0.8)
UNDET=grown & (field > 0.2) & (field < 0.8)
PAINT = grown & ~SKY
print(f"SKY(page belongs) {int(SKY.sum()):,}   BODY(determined skin) {int(BODY.sum()):,}   UNDET {int(UNDET.sum()):,}   PAINT {int(PAINT.sum()):,}")
# ── components of the paint set ──
def components(mask, minpx=25):
    lab=np.zeros(mask.shape,np.int32); nxt=0; out=[]
    ys,xs=np.nonzero(mask)
    from collections import deque
    seen=np.zeros_like(mask)
    for y0,x0 in zip(ys,xs):
        if seen[y0,x0]: continue
        nxt+=1; q=deque([(y0,x0)]); seen[y0,x0]=True; pts=[]
        while q:
            y,x=q.popleft(); pts.append((y,x))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                yy,xx=y+dy,x+dx
                if 0<=yy<mask.shape[0] and 0<=xx<mask.shape[1] and mask[yy,xx] and not seen[yy,xx]:
                    seen[yy,xx]=True; q.append((yy,xx))
        if len(pts)>=minpx: out.append(np.array(pts))
    return out
comps=components(PAINT)
comps.sort(key=len, reverse=True)
print(f"components >=25 px: {len(comps)}")
# recorded flags for cross-reference
rec=json.load(open(f"{E}/63-painted-keyform-list.json"))
def bbox_of(pts):
    y0,x0=pts.min(0); y1,x1=pts.max(0); return [int(x0),int(y0),int(x1)+1,int(y1)+1]
LUMA=np.array([0.2126,0.7152,0.0722],np.float32)
gy,gx=np.gradient(L)
gmag=np.hypot(gy,gx)
strong=gmag>np.percentile(gmag[MATTE_field] if False else gmag, 95)
regions=[]
for i,pts in enumerate(comps):
    m=np.zeros_like(PAINT); m[pts[:,0],pts[:,1]]=True
    bb=bbox_of(pts)
    cls = "BODY+UNDET"
    bodypx=int((m&BODY).sum()); undetpx=int((m&UNDET).sum())
    per_pose={k:int((m&v).sum()) for k,v in poses.items()}
    # rim: master-visible px around the region
    ring=_dil(m,4)&~m
    ring &= rest          # visible at rest
    if ring.sum()>0:
        lo=L[ring]
        rim={"n":int(ring.sum()),"luma_min":round(float(lo.min()),1),"luma_max":round(float(lo.max()),1),
             "luma_mean":round(float(lo.mean()),1),
             "edge_frac":round(float(strong[ring].mean()),3),
             "spec_px":int((lo>=250).sum())}
    else: rim={"n":0}
    # cross-reference recorded flags by bbox overlap
    tag=None
    for r in rec:
        rx0,ry0,rx1,ry1=r["bbox"]
        cx0,cy0,cx1,cy1=bb
        ix=max(0,min(cx1,rx1)-max(cx0,rx0)); iy=max(0,min(cy1,ry1)-max(cy0,ry0))
        if ix>0 and iy>0: tag=f"recorded flag #{r['rank']}"; break
    regions.append({"id":f"R{i+1:02d}","px":int(m.sum()),"bbox":bb,
                    "centroid":[round(float(pts[:,1].mean()),1),round(float(pts[:,0].mean()),1)],
                    "class_mix":{"body_determined":bodypx,"undetermined":undetpx},
                    "exposed_at":{k:v for k,v in per_pose.items() if v>0},
                    "rim":rim,"cross_ref":tag})
    np.save(f"{E}/keyform-package/R{i+1:02d}-mask.npy", m)
json.dump(regions, open(f"{E}/keyform-package/manifest.json","w"), indent=1)
for r in regions[:10]:
    print(f"   {r['id']} {r['px']:6,} px  bbox {r['bbox']}  body/det {r['class_mix']['body_determined']:5,} undet {r['class_mix']['undetermined']:6,}"
          f"  rim edge_frac {r['rim'].get('edge_frac','-')}  {r['cross_ref'] or ''}")
minor=int(PAINT.sum())-sum(r["px"] for r in regions)
print(f"   minor speckle below 25 px: {minor:,} px total")
print("SKY masks saved too")
np.save(f"{E}/keyform-package/SKY-page-belongs.npy", SKY)
np.save(f"{E}/keyform-package/BODY-determined.npy", BODY)

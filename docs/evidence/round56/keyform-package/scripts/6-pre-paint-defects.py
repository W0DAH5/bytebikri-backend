"""PRE-paint defect specification: what is wrong with the interim plate inside
each paint region, per pose, measured mechanically."""
import numpy as np, importlib.util, json
from PIL import Image
spec=importlib.util.spec_from_file_location("hv","app/scripts/holdout-validation.py")
hv=importlib.util.module_from_spec(spec); spec.loader.exec_module(hv)
src=open("app/scripts/buddha-rig-art.py").read()
ns={"np":np,"Image":Image,"ImageFilter":__import__("PIL.ImageFilter",fromlist=["ImageFilter"])}
i=src.index("\ndef _rotated(")+1; j=src.index("\ndef _kept(")
exec(compile(src[i:j].rstrip()+"\n","<p:_rotated>","exec"),ns)
_rotated=ns["_rotated"]
C="app/public/img/cosmetics"; R=f"{C}/rig"; E="docs/evidence/round56"; P=f"{E}/keyform-package"
master=np.asarray(Image.open(f"{C}/mascot-gold-buddha-base.png").convert("RGB")).astype(int)
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
plate=np.asarray(Image.open(f"{R}/clean-plate.webp").convert("RGBA")).astype(int)
GRA=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
L=hv.lum(master.astype(np.float32))
# classes, fixed solver, stated rule (same as the package build)
field,res=hv.membrane(MATTE.astype(np.float32), GRA | (np.asarray(Image.open(f"{R}/arm.webp").convert("RGBA"))[...,3]>128))
print(f"field residual {res:.6f} (sanity: 0.0030)")
holes=np.zeros(MATTE.shape,bool)
masks={}
for rid in ("R01","R02","R03","R04","R05"):
    m=np.load(f"{P}/{rid}-mask.npy"); masks[rid]=m; holes|=m
BODY=holes&(field>=0.8); UNDET=holes&(field>0.2)&(field<0.8)
rest=np.asarray(Image.open(f"{E}/06-pose-+0-alpha.png").getchannel("A"))>127
def arm_exposed(p):
    return rest & ~(np.asarray(Image.open(f"{E}/06-pose-{p}-alpha.png").getchannel("A"))>127)
gexp=np.zeros_like(MATTE)
for g in (-4.5,4.0):
    gexp |= GRA & ~_rotated(GRA,g,(740.0,90.0))
# STRICT checker detector: near-gray, at the backdrop's two luminance levels,
# inside a locally-flat (std<2) 7x7 patch, two-level alternating. The loose
# version also matched the master's own specular flats (8,291 px false hits).
pg=plate[...,0].astype(np.float32); pm=pg.mean() if False else None
prgb=plate[...,:3].astype(np.float32)
plum=prgb.mean(axis=2)
pgray=(np.abs(plate[...,0]-plate[...,1])<=10)&(np.abs(plate[...,1]-plate[...,2])<=10)&(np.abs(plate[...,0]-plate[...,2])<=10)
plevel=(np.abs(plum-241.5)<=3)|(np.abs(plum-253.5)<=3)
k=3
def _box(a):
    w=2*k+1
    q=np.pad(a,k,mode='edge')
    c=np.cumsum(np.cumsum(q,0),1)
    c=np.pad(c,((1,0),(1,0)))
    return c[w:,w:]-c[:-w,w:]-c[w:,:-w]+c[:-w,:-w]
pstd=np.sqrt(np.maximum(_box(plum*plum)-_box(plum)**2,0))
palt=(_box((plum>247).astype(np.float32))>0.15)&(_box((plum<=247).astype(np.float32))>0.15)
opaque=plate[...,3]>127
transp=plate[...,3]<=127
checker=opaque&pgray&plevel&(pstd<2.0)&palt
gold=opaque&~pgray&~checker
print(f"\ninside the holes ({int(holes.sum()):,} px):")
print(f"  plate opaque gold-fill : {int((holes&gold).sum()):7,}")
print(f"  plate opaque CHECKER   : {int((holes&checker).sum()):7,}  <- page pattern painted into the figure")
print(f"  plate transparent void : {int((holes&transp).sum()):7,}")
print(f"  (classes: body {int(BODY.sum()):,} + undet {int(UNDET.sum()):,} = {int((BODY|UNDET).sum()):,}; sky in holes 0)")
print(f"\nchecker copy is static under the limb at rest? checker px covered at rest: {int((holes&checker&rest).sum()):,} of {int((holes&checker).sum()):,}")
out={"holes":int(holes.sum()),
     "plate_gold":int((holes&gold).sum()),"plate_checker":int((holes&checker).sum()),"plate_void":int((holes&transp).sum()),
     "classes":{"body":int(BODY.sum()),"undetermined":int(UNDET.sum())},
     "recorded_classes":{"body":3389,"sky":5517,"undetermined":12444},
     "per_region":{},"per_pose":{}}
for rid,m in masks.items():
    out["per_region"][rid]={"px":int(m.sum()),
        "gold":int((m&gold).sum()),"checker":int((m&checker).sum()),"void":int((m&transp).sum()),
        "body":int((m&BODY).sum()),"undet":int((m&UNDET).sum())}
poses={"REST":np.zeros_like(MATTE),"-3":arm_exposed("-3"),"-7":arm_exposed("-7"),"-15":arm_exposed("-15")}
poses["grapes sway"]=gexp
for pn,exp in poses.items():
    vis=exp&holes
    row={"exposed_in_holes":int(vis.sum()),
         "void_revealed":int((vis&transp).sum()),
         "checker_revealed":int((vis&checker).sum()),
         "gold_ok_revealed":int((vis&gold).sum())}
    out["per_pose"][pn]=row
    print(f"  pose {pn:12s} exposes {row['exposed_in_holes']:6,} hole px: {row['void_revealed']:6,} void + {row['checker_revealed']:6,} checker + {row['gold_ok_revealed']:6,} interim gold")
json.dump(out, open(f"{P}/pre-paint-defects.json","w"), indent=1)
print("\nwrote keyform-package/pre-paint-defects.json")

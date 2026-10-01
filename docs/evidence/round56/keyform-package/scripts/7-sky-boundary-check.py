import numpy as np, importlib.util
from PIL import Image
spec=importlib.util.spec_from_file_location("hv","app/scripts/holdout-validation.py")
hv=importlib.util.module_from_spec(spec); spec.loader.exec_module(hv)
src=open("app/scripts/buddha-rig-art.py").read()
ns={"np":np,"Image":Image,"ImageFilter":__import__("PIL.ImageFilter",fromlist=["ImageFilter"])}
i=src.index("\ndef _dil(")+1; j=src.index("\ndef _rotated(")
exec(compile(src[i:j].rstrip()+"\n","<p:_dil>","exec"),ns)
i=src.index("\ndef _rotated(")+1; j=src.index("\ndef _kept(")
exec(compile(src[i:j].rstrip()+"\n","<p:_rotated>","exec"),ns)
_dil,_rot=ns["_dil"],ns["_rotated"]
C="app/public/img/cosmetics"; R=f"{C}/rig"; E="docs/evidence/round56"; P=f"{E}/keyform-package"
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
ARM=np.asarray(Image.open(f"{R}/arm.webp").convert("RGBA"))[...,3]>128
GRA=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
LIMB=ARM|GRA
field,res=hv.membrane(MATTE.astype(np.float32), LIMB)
raw_arm=np.zeros_like(MATTE)
rest=np.asarray(Image.open(f"{E}/06-pose-+0-alpha.png").getchannel("A"))>127
for p in ("+6","-3","-7","-15"):
    raw_arm |= rest & ~(np.asarray(Image.open(f"{E}/06-pose-{p}-alpha.png").getchannel("A"))>127)
raw = raw_arm | (GRA & ~_rot(GRA,-4.5,(740.0,90.0))) | (GRA & ~_rot(GRA,4.0,(740.0,90.0)))
grown=_dil(raw,6)&LIMB
SKY=grown&(field<=0.2)
holes=np.zeros(LIMB.shape,bool)
for rid in ("R01","R02","R03","R04","R05"):
    holes|=np.load(f"{P}/{rid}-mask.npy")
pl=np.asarray(Image.open(f"{R}/clean-plate.webp").convert("RGBA"))[...,3]>127
bad=SKY&pl
print(f"SKY total {int(SKY.sum()):,}; plate-opaque on SKY: {int(bad.sum())}")
print(f"  of those inside the paint regions: {int((bad&holes).sum())}  OUTSIDE: {int((bad&~holes).sum())}")
o=bad&~holes
ys,xs=np.nonzero(o)
if len(ys):
    print(f"  outside bbox x {xs.min()}..{xs.max()} y {ys.min()}..{ys.max()}")
    # exposed by the gesture?
    gexp=GRA & ~_rot(GRA,-4.5,(740.0,90.0)) | (GRA & ~_rot(GRA,4.0,(740.0,90.0)))
    aexp=raw_arm
    print(f"  exposed by arm keyforms: {int((o&aexp).sum())}   by grape sway: {int((o&gexp).sum())}")
    for y,x in list(zip(ys,xs))[:10]: print(f"    px at x={x} y={y}")

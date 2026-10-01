import numpy as np, importlib.util, json
from PIL import Image
spec=importlib.util.spec_from_file_location("hv","app/scripts/holdout-validation.py")
hv=importlib.util.module_from_spec(spec); spec.loader.exec_module(hv)
src=open("app/scripts/buddha-rig-art.py").read()
ns={"np":np,"Image":Image,"ImageFilter":__import__("PIL.ImageFilter",fromlist=["ImageFilter"])}
i=src.index("\ndef _dil(")+1; j=src.index("\ndef _rotated(")
exec(compile(src[i:j].rstrip()+"\n","<p:_dil>","exec"),ns)
i=src.index("\ndef _rotated(")+1; j=src.index("\ndef _kept(")
exec(compile(src[i:j].rstrip()+"\n","<p:_rotated>","exec"),ns)
_dil,_rotated=ns["_dil"],ns["_rotated"]
C="app/public/img/cosmetics"; R=f"{C}/rig"
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
ARM=np.asarray(Image.open(f"{R}/arm.webp").convert("RGBA"))[...,3]>128
GRA=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
LIMB=ARM|GRA
rest=np.asarray(Image.open("docs/evidence/round56/06-pose-+0-alpha.png").getchannel("A"))>127
arm_exposed=np.zeros_like(MATTE)
for p in ("+6","-3","-7","-15"):
    arm_exposed |= rest & ~(np.asarray(Image.open(f"docs/evidence/round56/06-pose-{p}-alpha.png").getchannel("A"))>127)
raw = arm_exposed | (GRA & ~_rotated(GRA,-4.5,(740.0,90.0))) | (GRA & ~_rotated(GRA,4.0,(740.0,90.0)))
grown = _dil(raw,6) & LIMB
print(f"raw {int(raw.sum()):,} (rec 12,892)   grown {int(grown.sum()):,} (rec 21,350)")
np.save("/tmp/art_grown.npy", grown); np.save("/tmp/art_raw.npy", raw)
# the silhouette field, FIXED membrane (deterministic, no allocator garbage)
LIMBf=LIMB.astype(np.float32)
field,res=hv.membrane(MATTE.astype(np.float32), LIMB)
print(f"field residual {res:.6f}  finite {bool(np.isfinite(field).all())}")
np.save("/tmp/art_field.npy", field)
for t in (0.10,0.15,0.20,0.25,0.30,0.35,0.40,0.45):
    BODY = grown & (field> 0.5+t)
    SKY  = grown & (field< 0.5-t)
    UNDET= grown & ~(field> 0.5+t) & ~(field< 0.5-t)
    print(f"t={t:.2f}: BODY {int(BODY.sum()):,} (rec 3,389)  SKY {int(SKY.sum()):,} (rec 5,517)  UNDET {int(UNDET.sum()):,} (rec 12,444)")
pl=np.asarray(Image.open(f"{R}/clean-plate.webp").convert("RGBA"))[...,3]>127
print("plate opaque on grown:", int((grown&pl).sum()), "(rec 11,053)")

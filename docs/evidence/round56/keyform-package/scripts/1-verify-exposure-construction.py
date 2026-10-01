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
_dil,_rotated=ns["_dil"],ns["_rotated"]
C="app/public/img/cosmetics"; R=f"{C}/rig"
al=np.asarray(Image.open(f"{C}/master-alpha.png")); MATTE=(al>127) if al.max()>1 else (al>0.5)
GRA=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
rest=np.asarray(Image.open("docs/evidence/round56/06-pose-+0-alpha.png").getchannel("A"))>127
arm_exposed=np.zeros_like(MATTE)
for p in ("+6","-3","-7","-15"):
    arm_exposed |= rest & ~(np.asarray(Image.open(f"docs/evidence/round56/06-pose-{p}-alpha.png").getchannel("A"))>127)
print("arm-swing exposure:", int(arm_exposed.sum()))
for gra_angles in ((-4.5,4.0),(-4.5,4.0,1.5),(-5.0,5.0)):
    gexp=np.zeros_like(MATTE)
    for g in gra_angles:
        gexp |= GRA & ~_rotated(GRA, g, (740.0,90.0))
    tot=arm_exposed|gexp
    grown=_dil(tot,6)&MATTE
    print(f"grape {gra_angles}: grape adds {int(gexp.sum()):,}  raw {int(tot.sum()):,} (rec 12,892)  grown {int(grown.sum()):,} (rec 21,350)")

tot=arm_exposed | (GRA & ~_rotated(GRA,-4.5,(740.0,90.0))) | (GRA & ~_rotated(GRA,4.0,(740.0,90.0)))
for r in (2,3,4,5):
    g=_dil(tot,r)&MATTE
    print(f"   dil r={r}: grown {int(g.sum()):,} (rec 21,350)")
g6=_dil(tot,6)&MATTE
# maybe the margin excludes px the limb still covers in SOME pose:
never_visible = np.ones_like(MATTE)
for p in ("+6","-3","-7","-15"):
    never_visible &= ~(np.asarray(Image.open(f"docs/evidence/round56/06-pose-{p}-alpha.png").getchannel("A"))>127)
g6n = g6 & never_visible
print(f"   dil r=6 & never-visible-at-any-pose: {int(g6n.sum(),) if False else int(g6n.sum()):,}")

ARM=np.asarray(Image.open(f"{R}/arm.webp").convert("RGBA"))[...,3]>128
GRA2=np.asarray(Image.open(f"{R}/grapes.webp").convert("RGBA"))[...,3]>128
LIMB=ARM|GRA2
g=_dil(tot,6)&LIMB
print(f"   dil r=6 & LIMB(rest): {int(g.sum()):,} (rec 21,350)")
for r in (4,5,7,8):
    print(f"   dil r={r} & LIMB(rest): {int((_dil(tot,r)&LIMB).sum()):,}")

import numpy as np, json, os
from PIL import Image, ImageDraw
C="app/public/img/cosmetics"; E="docs/evidence/round56"; P=f"{E}/keyform-package"
master=Image.open(f"{C}/mascot-gold-buddha-base.png").convert("RGB")
rgb=np.asarray(master)
regions=json.load(open(f"{P}/manifest.json"))
MARGIN=24
for r in regions:
    m=np.load(f"{P}/{r['id']}-mask.npy")
    x0,y0,x1,y1=r["bbox"]
    cx0,cy0=max(0,x0-MARGIN),max(0,y0-MARGIN)
    cx1,cy1=min(rgb.shape[1],x1+MARGIN),min(rgb.shape[0],y1+MARGIN)
    crop=rgb[cy0:cy1,cx0:cx1].copy()
    mc=m[cy0:cy1,cx0:cx1]
    # edge ring for the outline (mask minus eroded mask)
    from collections import deque
    er=mc.copy()
    for sh,ax in ((mc[1:,:],0),): pass
    inner=mc & np.roll(mc,1,0) & np.roll(mc,-1,0) & np.roll(mc,1,1) & np.roll(mc,-1,1)
    edge=mc & ~inner
    t=np.zeros((crop.shape[0],crop.shape[1],4),np.uint8)
    t[...,:3]=crop; t[...,3]=255
    t[mc]=(0,0,0,0)                      # the hole to paint
    t[edge]=(255,170,0,255)              # amber outline
    im=Image.fromarray(t,"RGBA")
    fn=f"{P}/{r['id']}-template.png"; im.save(fn)
    r["template"]=f"keyform-package/{r['id']}-template.png"
    r["template_offset"]=[int(cx0),int(cy0)]
    # painter anchors: mean master color on each side of the hole
    def ringmean(sel_flat):
        if not sel_flat.any(): return None
        m2=np.zeros_like(mc); m2[ys[sel_flat],xs[sel_flat]]=True
        c=crop[m2].mean(0); return [int(c[0]),int(c[1]),int(c[2])]
    ys,xs=np.nonzero(mc)
    r["anchors"]={
      "top":ringmean(ys==ys.min()),
      "bottom":ringmean(ys==ys.max()),
      "left":ringmean(xs==xs.min()),
      "right":ringmean(xs==xs.max())}
json.dump(regions, open(f"{P}/manifest.json","w"), indent=1)
# overview sheet at 1x with numbered overlays
ov=master.copy(); d=ImageDraw.Draw(ov,"RGBA")
BODY=np.load(f"{P}/BODY-determined.npy"); 
for r in regions:
    m=np.load(f"{P}/{r['id']}-mask.npy")
    b=m&BODY; u=m&~BODY
    ov_arr=np.asarray(ov).copy()
    ov_arr[b]=[60,200,255]; ov_arr[u]=[255,170,0]
    ov=Image.fromarray(ov_arr); d=ImageDraw.Draw(ov,"RGBA")
    cx,cy=r["centroid"]
    d.text((cx-8,cy-8), r["id"][1:], fill=(255,255,255,255))
SKY=np.load(f"{P}/SKY-page-belongs.npy")
ov_arr=np.asarray(ov).copy(); ov_arr[SKY]=[90,110,255]
ov=Image.fromarray(ov_arr)
d=ImageDraw.Draw(ov)
for r in regions:
    cx,cy=r["centroid"]; d.text((cx-8,cy-8), r["id"][1:], fill=(255,255,255))
ov.save(f"{P}/00-overview.png")
print("templates + overview written")
for r in regions: print("  ",r["id"], r["template"], r["template_offset"], f"{r['px']:,} px")

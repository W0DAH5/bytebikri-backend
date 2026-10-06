/**
 * buddha-rig.js — the parts-rig runtime (CHARACTER_ANIMATION.md §7, §10 step 4).
 *
 * Renders the Golden Buddha from the Python-authored rig data
 * (img/cosmetics/buddha-rig/buddha-rig.json) with REAL mesh deformation:
 * the arm is a 26x12 MeshGeometry deformed per frame by linear blend
 * skinning + the painted-keyform pull; the chest is a mesh deformed by the
 * breath field; the handover steps arm+grapes out and the drawn-behind
 * lowered pose in; expression/keyform patches cross-fade by the parameter
 * gates, rotated with the upper-arm bone, clipped to the LIVE composed
 * figure via a render-texture mask. No CSS transform touches the character.
 *
 * The numeric recipes are the proved ones (rig-parts-eval.py / rig-cycle.py);
 * app/scripts/rig-runtime-parity.mjs asserts this evaluator against the
 * Python's PARITY block.
 *
 * Harness use (preview page):
 *   BuddhaRig.mount(canvasElement, { fixedTime: 0 })  -> controller {setTime, destroy}
 *   BuddhaRig.load() -> Promise<rigJSON>
 * NOT wired into the production page — awaiting explicit authorization.
 */
(function () {
  "use strict";

  const DEG = Math.PI / 180;

  function sstep(x) {
    return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  }

  // identical to the Python eval_curve
  function evalCurve(c, t) {
    const p = c.period;
    const tt = ((t % p) + p) % p;
    const ks = c.keys;
    if (tt <= ks[0][0]) return ks[0][1];
    for (let i = 0; i < ks.length - 1; i++) {
      const [t0, v0] = ks[i];
      const [t1, v1] = ks[i + 1];
      if (tt >= t0 && tt <= t1) {
        if (t1 === t0) return v1;
        let u = (tt - t0) / (t1 - t0);
        if (c.easing === "smoothstep") u = u * u * (3 - 2 * u);
        return v0 + u * (v1 - v0);
      }
    }
    return ks[ks.length - 1][1];
  }

  // the arm LBS, verbatim from lbss(): upper arm about SH, forearm adds
  // 0.35x about the elbow, then the keyform pull toward the shoulder near
  // the T=0.25 band. Poses are FLOAT arrays of length 2*n.
  function lbss(rig, deg, out) {
    const m = rig.arm_mesh, kf = m.keyform;
    const rest = m.rest, wf = m.w_fore;
    const [shx, shy] = rig.bones.shoulder;
    const [elx, ely] = rig.bones.elbow;
    const th1 = deg * DEG, th2 = deg * m.forearm_gain * DEG;
    const c1 = Math.cos(th1), s1 = Math.sin(th1);
    const c2 = Math.cos(th2), s2 = Math.sin(th2);
    // keyform strength: piecewise-linear over the table
    const tbl = kf.table;
    let k = tbl[0][1];
    for (let i = 0; i < tbl.length - 1; i++) {
      const [d0, v0] = tbl[i], [d1, v1] = tbl[i + 1];
      if (deg >= d0 && deg <= d1) { k = v0 + (deg - d0) / (d1 - d0) * (v1 - v0); break; }
      if (deg < tbl[0][0]) { k = tbl[0][1]; break; }
      if (deg > tbl[tbl.length - 1][0]) { k = tbl[tbl.length - 1][1]; }
    }
    const n = rest.length / 2;
    for (let i = 0; i < n; i++) {
      const rx = rest[2 * i], ry = rest[2 * i + 1];
      const dx = rx - shx, dy = ry - shy;
      const ux = shx + c1 * dx + s1 * dy;
      const uy = shy - s1 * dx + c1 * dy;
      // elbow rotated by R1 about the shoulder (Python's `elb`)
      const e0x = elx - shx, e0y = ely - shy;
      const elrx = shx + c1 * e0x + s1 * e0y;
      const elry = shy - s1 * e0x + c1 * e0y;
      // forearm offset rotated by the PRODUCT R1@R2: R2 first, then R1
      const edx = rx - elx, edy = ry - ely;
      const r2x = c2 * edx + s2 * edy;
      const r2y = -s2 * edx + c2 * edy;
      const fx = elrx + c1 * r2x + s1 * r2y;
      const fy = elry - s1 * r2x + c1 * r2y;
      const w = wf[i];
      let x = (1 - w) * ux + w * fx;
      let y = (1 - w) * uy + w * fy;
      // keyform pull: t of the vertex along shoulder->fist, band near 0.25
      const fdx = rig.bones.fist[0] - shx, fdy = rig.bones.fist[1] - shy;
      const tv = (dx * fdx + dy * fdy) / (fdx * fdx + fdy * fdy);
      const near = Math.max(0, Math.min(1, 1 - Math.abs(tv - kf.band_center) / kf.band_halfwidth));
      x += k * kf.gain * near * (shx - x);
      y += k * kf.gain * near * (shy - y);
      out[2 * i] = x; out[2 * i + 1] = y;
    }
    return out;
  }

  // breath displacement at chest-mesh vertices (identity at rest, zero on
  // the mesh border — the exported weights already carry the taper)
  function headTiltPose(rig, deg, out) {
    const hm = rig.head_mesh;
    const n = hm.rest.length / 2;
    const th = deg * DEG;
    const [cx, cy] = hm.pivot;
    for (let i = 0; i < n; i++) {
      const x = hm.rest[2 * i], y = hm.rest[2 * i + 1];
      const w = hm.weights[i];
      out[2 * i] = x - th * (y - cy) * w;
      out[2 * i + 1] = y + th * (x - cx) * w;
    }
    return out;
  }

  function breathPose(rig, breath, out) {
    const bm = rig.breath_mesh;
    const n = bm.rest.length / 2;
    for (let i = 0; i < n; i++) {
      const x = bm.rest[2 * i], y = bm.rest[2 * i + 1];
      const w = bm.weights[i];
      out[2 * i] = x + bm.bulge * breath * Math.sin((x - bm.bulge_cx) / bm.bulge_xscale) * w;
      out[2 * i + 1] = y - bm.rise * breath * w;
    }
    return out;
  }

  function setVerts(geometry, arr) {
    const buf = geometry.getBuffer("aVertexPosition");
    buf.data.set(arr);
    buf.update();
  }

  function makeMesh(rig, texByPath, spec, texName) {
    const tex = texByPath[rig.textures[texName]];
    const geo = new PIXI.MeshGeometry(
      new Float32Array(spec.rest.slice()),
      new Float32Array(spec.uv.flat()),
      new Uint16Array(spec.triangles)
    );
    // v7.4 does NOT wrap a raw Texture into a shader (the ci/eyes browser
    // proof caught this): an explicit MeshMaterial is required.
    return new PIXI.Mesh(geo, new PIXI.MeshMaterial(tex));
  }

  function makeQuad(rig, texByPath, texName) {
    const tex = texByPath[rig.textures[texName]];
    const { w, h } = rig.canvas;
    const geo = new PIXI.MeshGeometry(
      new Float32Array([0, 0, w, 0, w, h, 0, h]),
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      new Uint16Array([0, 1, 2, 0, 2, 3])
    );
    return new PIXI.Mesh(geo, new PIXI.MeshMaterial(tex));
  }

  async function load(baseDir) {
    baseDir = baseDir || "img/cosmetics/buddha-rig";
    const rig = await (await fetch(baseDir + "/buddha-rig.json")).json();
    const texByPath = {};
    for (const key of Object.keys(rig.textures)) {
      texByPath[rig.textures[key]] = PIXI.Texture.from(rig.textures[key]);
    }
    return { rig, texByPath };
  }

  /**
   * Mount the living Buddha on a canvas. opts.fixedTime pins the pose
   * (harness panels); otherwise the 24s cycle runs on its own clock.
   */
  async function mount(canvas, opts) {
    opts = opts || {};
    const { rig, texByPath } = await load(opts.baseDir);
    const { w, h } = rig.canvas;
    // section 8 "the reduced-motion still": a reduced-motion preference pins
    // the character at REST instead of running the cycle.
    if (opts.fixedTime === undefined &&
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      opts.fixedTime = 0;
    }

    const app = new PIXI.Application({
      view: canvas, width: w, height: h, backgroundAlpha: 0, antialias: false, autoDensity: false,
    });
    const stage = app.stage;

    // shared geometries, two Mesh instances each (scene + figure mask)
    const armMeshScene = makeMesh(rig, texByPath, rig.arm_mesh, "arm");
    const chestMeshScene = makeMesh(rig, texByPath, rig.breath_mesh, "torso");
    const headMeshScene = makeMesh(rig, texByPath, rig.head_mesh, "head");
    function twin(m) { return new PIXI.Mesh(m.geometry, m.shader); }   // shares the material; uniforms are set per render

    const layers = new PIXI.Container();
    const backingQ = makeQuad(rig, texByPath, "plate-backing");
    const torsoQ = makeQuad(rig, texByPath, "torso");
    const strandQ = makeQuad(rig, texByPath, "strand");
    const loweredQ = makeQuad(rig, texByPath, "lowered");
    const grapes = new PIXI.Sprite(texByPath[rig.textures.grapes]);
    grapes.pivot.set(rig.bones.grape_pivot[0], rig.bones.grape_pivot[1]);
    grapes.position.set(rig.bones.grape_pivot[0], rig.bones.grape_pivot[1]);
    layers.addChild(backingQ, torsoQ, headMeshScene, chestMeshScene, strandQ, loweredQ, armMeshScene, grapes);
    stage.addChild(layers);

    // patches, masked by the LIVE composed figure (render texture)
    const patchDefs = [
      ["face-blink", false], ["face-smile", false], ["face-mouth", false], ["face-brow", false],
      ["kf-p6", true], ["kf-m7", true], ["kf-m15", true],
    ];
    const patchBox = new PIXI.Container();
    const patches = {};
    for (const [name, ridesArm] of patchDefs) {
      const s = new PIXI.Sprite(texByPath[rig.textures[name]]);
      if (ridesArm) {
        s.pivot.set(rig.bones.shoulder[0], rig.bones.shoulder[1]);
        s.position.set(rig.bones.shoulder[0], rig.bones.shoulder[1]);
      }
      s.renderable = false;
      patches[name] = s;
      patchBox.addChild(s);
    }
    stage.addChild(patchBox);

    // the mask stage mirrors the draw order with shared geometries
    const maskStage = new PIXI.Container();
    const maskArm = twin(armMeshScene);
    const maskChest = twin(chestMeshScene);
    const maskHead = twin(headMeshScene);
    const maskGrapes = new PIXI.Sprite(grapes.texture);
    maskGrapes.pivot.copyFrom(grapes.pivot); maskGrapes.position.copyFrom(grapes.position);
    const maskLowered = makeQuad(rig, texByPath, "lowered");
    maskStage.addChild(makeQuad(rig, texByPath, "plate-backing"),
      makeQuad(rig, texByPath, "torso"), maskHead, maskChest,
      makeQuad(rig, texByPath, "strand"), maskLowered, maskArm, maskGrapes);
    const rt = PIXI.RenderTexture.create({ width: w, height: h, resolution: 1 });
    const maskSprite = new PIXI.Sprite(rt);
    patchBox.mask = maskSprite;

    const hand0 = rig.handover.window[0], hand1 = rig.handover.window[1];
    const armPose = new Float32Array(rig.arm_mesh.rest.length);
    const chestPose = new Float32Array(rig.breath_mesh.rest.length);
    const headPose = new Float32Array(rig.head_mesh.rest.length);

    function apply(t, ov) {
      ov = ov || {};
      const deg = evalCurve(rig.curves.arm_angle, t);
      const sway = evalCurve(rig.curves.grape_sway, t);
      const breath = evalCurve(rig.curves.breath, t);
      const blink = ov.blink !== undefined ? ov.blink : evalCurve(rig.curves.blink, t);
      const tilt = evalCurve(rig.curves.head_tilt, t);
      const tt = ((t % 24) + 24) % 24;
      const window = tt >= hand0 && tt <= hand1;

      lbss(rig, deg, armPose);
      setVerts(armMeshScene.geometry, armPose);
      breathPose(rig, breath, chestPose);
      setVerts(chestMeshScene.geometry, chestPose);
      chestMeshScene.renderable = breath > 0.001;
      headTiltPose(rig, tilt, headPose);
      setVerts(headMeshScene.geometry, headPose);
      // ALWAYS rendered: the head px live ONLY in head.png (split out of the
      // torso texture), and at rest the identity pose draws them bit-exactly.
      headMeshScene.renderable = true;

      grapes.rotation = -sway * DEG;          // PIL rotate() is CCW; Pixi y-down is CW
      loweredQ.renderable = window;
      armMeshScene.renderable = !window;
      grapes.renderable = !window;

      // patch gates (identical to the Python fades; keyforms skip the window)
      const deep = sstep((-deg - 10) / 4);
      const mid = sstep((-deg - 1.5) / 3) * (1 - deep);
      const offer = sstep((deg - 3) / 3);
      const rot = -deg * DEG;
      const gates = {
        "face-blink": blink, "face-smile": offer, "face-mouth": offer,
        "face-brow": deep, "kf-p6": window ? 0 : offer,
        "kf-m7": window ? 0 : mid, "kf-m15": window ? 0 : deep,
      };
      for (const [name] of patchDefs) {
        const k = Math.min(1, gates[name]);
        const s = patches[name];
        s.renderable = k > 0.004;
        if (s.renderable) { s.alpha = k; if (s.pivot.x) s.rotation = rot; }
        const hw = rig.patch_head_weight ? rig.patch_head_weight[name] : undefined;
        if (s.renderable && hw !== undefined) {
          // face patches ride the head tilt rigidly at the band's own weight
          // (the soft field across a patch varies by <2px; documented approx)
          if (!s.__headPivot) {
            s.__headPivot = true;
            const pv = rig.head_mesh.pivot;
            s.pivot.set(pv[0], pv[1]);
            s.position.set(pv[0], pv[1]);
          }
          s.rotation = tilt * hw * BuddhaRig.DEG;
        }
      }

      // sync + render the live-figure mask, then let Pixi apply it
      maskArm.renderable = armMeshScene.renderable;
      maskGrapes.renderable = grapes.renderable;
      maskGrapes.rotation = grapes.rotation;
      maskLowered.renderable = window;
      maskChest.renderable = chestMeshScene.renderable;
      maskHead.renderable = true;
      setVerts(maskHead.geometry, headPose);
      app.renderer.render(maskStage, { renderTexture: rt });

      return { deg, sway, breath, blink, window };
    }

    let raf = 0, t0 = performance.now(), last = null;
    function frame(now) {
      const t = opts.fixedTime !== undefined ? opts.fixedTime : ((now - t0) / 1000);
      last = apply(t);
      raf = requestAnimationFrame(frame);
    }
    if (!opts.paused) raf = requestAnimationFrame(frame);   // harness: paused mounts are driven by apply()
    else apply(opts.fixedTime !== undefined ? opts.fixedTime : 0);   // paused mounts still render their initial pose once

    return {
      rig,
      apply,
      // harness: synchronous pixel readback of the composed character
      snapshot() {
        const c = app.renderer.extract.canvas(layers);
        return c.toDataURL("image/png");
      },
      setTime(t) { t0 = performance.now() - t * 1000; },
      destroy() { cancelAnimationFrame(raf); app.destroy(false, { children: true, texture: false }); },
      get lastState() { return last; },
    };
  }

  window.BuddhaRig = { load, mount, evalCurve, sstep, lbss, breathPose, headTiltPose, DEG };
})();

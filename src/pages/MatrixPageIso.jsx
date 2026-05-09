import { useEffect, useRef, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import * as PIXI from "pixi.js"
import emblemSrc from "../assets/emblem.svg"
import { parseMinecraftWorld } from "./minecraftParser"
import { renderWorldIsometric, createOctagonMask } from "./isoVoxelRenderer"

function getTilePosition(index, tileSize, gap) {
  const spacing = tileSize * 2 + gap
  if (index === 0) return { x: 0, y: 0 }
  let ring = 1
  let count = 0
  while (count + ring * 8 < index) {
    count += ring * 8
    ring++
  }
  const posInRing = index - count - 1
  const angleStep = (Math.PI * 2) / (ring * 8)
  const angle = angleStep * posInRing - Math.PI / 2
  const radius = ring * spacing
  return { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) }
}

function isoProject(x, y, h = 0) {
  return { x: (x - y) * 0.88, y: (x + y) * 0.46 - h }
}

function getOctagonPoints(width, height) {
  const points = []
  const steps = 8
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2
    points.push(Math.cos(angle) * width, Math.sin(angle) * height)
  }
  return points
}

const CITIES = [
  { id: 0, name: "مدينة القائد", color: 0x1A3A2A, isLeader: true, tier: "القائد" },
  { id: 1, name: "مدينة الفجر", color: 0x1A2A3A, isAsateen: true, tier: "الأساة" },
  { id: 2, name: "مدينة الصخر", color: 0x2A1A1A, isAsateen: true, tier: "الأساة" },
  { id: 3, name: "مدينة النور", color: 0x1A2A1A, isAsateen: true, tier: "الأساة" },
  { id: 4, name: "مدينة الريح", color: 0x2A1A2A, isAsateen: true, tier: "الأساة" },
]

const TILE_SIZE = 72
const GAP = 36
const OCT_W = 62
const OCT_H = 28

export default function MatrixPageIso() {
  const canvasRef = useRef(null)
  const navigate = useNavigate()
  const [tooltip, setTooltip] = useState(null)
  const [applyPrompt, setApplyPrompt] = useState(null)
  const [hoveredBtn, setHoveredBtn] = useState(null)
  const [worldDataMap, setWorldDataMap] = useState({})
  const [uploadingCity, setUploadingCity] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [selectedCity, setSelectedCity] = useState(null)
  const [parseLoading, setParseLoading] = useState(false)
  const isMounted = useRef(true)
  const appRef = useRef(null)
  const islandContainersRef = useRef({})
  const fileInputRef = useRef(null)
  const cityParam = window.location.pathname.match(/\/city\/(.+)/)?.[1]
  const initialCityName = cityParam ? decodeURIComponent(cityParam) : null // eslint-disable-line no-unused-vars

  const btnStyle = (id) => ({
    background: "transparent",
    border: "none",
    color: hoveredBtn === id ? "#C9A84C" : "#D4B483",
    fontFamily: "Amiri, Georgia, serif",
    fontSize: "13px",
    cursor: "pointer",
    padding: "2px 6px",
    transition: "color 0.2s",
    fontWeight: 500,
  })

  const handleWorldUpload = useCallback(async (file, cityId) => {
    try {
      setParseError(null)
      setParseLoading(true)
      const result = await parseMinecraftWorld(file, 48)
      setWorldDataMap((prev) => ({ ...prev, [cityId]: result }))
      setSelectedCity(null)
    } catch (err) {
      setParseError(`خطأ في قراءة الملف: ${err.message}`)
      setTimeout(() => setParseError(null), 5000)
    } finally {
      setUploadingCity(null)
      setParseLoading(false)
    }
  }, [])

  const onFileSelected = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file && uploadingCity !== null) {
      handleWorldUpload(file, uploadingCity)
    }
    e.target.value = ""
  }, [uploadingCity, handleWorldUpload])

  useEffect(() => {
    if (!canvasRef.current) return
    const app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0A1628,
      antialias: true,
      resizeTo: window,
    })
    appRef.current = app
    canvasRef.current.innerHTML = ""
    canvasRef.current.appendChild(app.view)

    const water = new PIXI.Sprite(PIXI.Texture.WHITE)
    water.width = app.screen.width
    water.height = app.screen.height
    water.tint = 0x0A1628
    app.stage.addChild(water)

    const waterShader = `
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform vec2 uResolution;
      uniform float uTime;
      
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      void main() {
        vec2 uv = vTextureCoord;
        vec2 p = uv * uResolution;
        float t = uTime * 0.6;
        
        float wave = sin(p.x * 0.015 + t * 0.8) * 0.15 +
                     sin(p.y * 0.018 - t * 0.6) * 0.12 +
                     snoise(p * 0.01 + t * 0.05) * 0.08;
                     
        vec3 base = vec3(0.04, 0.09, 0.16);
        vec3 highlight = vec3(0.08, 0.16, 0.28);
        vec3 color = mix(base, highlight, wave * 0.5 + 0.5);
        
        float fog = smoothstep(0.0, 0.8, length(uv - 0.5));
        color = mix(color, vec3(0.02, 0.04, 0.08), fog * 0.4);
        
        gl_FragColor = vec4(color, 1.0);
      }
    `

    const waterFilter = new PIXI.Filter(undefined, waterShader, {
      uResolution: [app.screen.width, app.screen.height],
      uTime: 0,
    })
    water.filters = [waterFilter]

    const worldContainer = new PIXI.Container()
    worldContainer.x = app.screen.width / 2
    worldContainer.y = app.screen.height / 2 + 26
    app.stage.addChild(worldContainer)

    const tileRefs = []
    let leaderRing = null
    let leaderStar = null

    const octShadow = getOctagonPoints(OCT_W + 6, OCT_H + 4)
    const octMid = getOctagonPoints(OCT_W - 4, OCT_H - 2)
    const octTop = getOctagonPoints(OCT_W, OCT_H)
    const octRing = getOctagonPoints(OCT_W + 6, OCT_H + 4)
    const octFoam = getOctagonPoints(OCT_W + 2, OCT_H + 2)

    for (let i = 0; i < 24; i++) {
      const pos = getTilePosition(i, TILE_SIZE, GAP)
      const iso = isoProject(pos.x, pos.y)
      const city = CITIES.find((c) => c.id === i)
      const island = new PIXI.Container()
      island.x = iso.x
      island.y = iso.y

      const shadow = new PIXI.Graphics()
      shadow.beginFill(0x000000, 0.35)
      shadow.drawPolygon(octShadow.map((v, idx) => idx % 2 === 0 ? v + 4 : v + 8))
      shadow.endFill()
      shadow.y = 6
      island.addChild(shadow)

      const foam = new PIXI.Graphics()
      foam.lineStyle(0)
      foam.beginFill(0xD4E6F1, 0.25)
      foam.drawPolygon(octFoam)
      foam.endFill()
      island.addChild(foam)

      const mid = new PIXI.Graphics()
      mid.beginFill(city ? 0x2A2A2A : 0x101824, city ? 0.92 : 0.42)
      mid.drawPolygon(octMid.map((v, idx) => idx % 2 === 0 ? v : v + 2))
      mid.endFill()
      island.addChild(mid)

      const top = new PIXI.Graphics()
      top.lineStyle(
        city ? (city.isLeader ? 2.4 : 1.8) : 0.8,
        city ? (city.isLeader ? 0xC9A84C : city.isAsateen ? 0xE1BE63 : 0xC9A84C) : 0x2B3B4E,
        city ? 0.9 : 0.24
      )
      top.beginFill(city ? city.color : 0x0D1220, city ? 0.96 : 0.25)
      top.drawPolygon(octTop)
      top.endFill()
      island.addChild(top)

      const worldLayer = new PIXI.Container()
      worldLayer.name = `world-${i}`
      island.addChild(worldLayer)

      if (city?.isLeader) {
        leaderRing = new PIXI.Graphics()
          .lineStyle(1.8, 0xC9A84C, 0.55)
          .drawPolygon(octRing.map((v, idx) => idx % 2 === 0 ? v * 1.15 : v * 1.15))
        island.addChild(leaderRing)

        leaderStar = new PIXI.Text("✦", {
          fontFamily: "Amiri, Georgia, serif",
          fontSize: 16,
          fill: 0xC9A84C,
        })
        leaderStar.anchor.set(0.5)
        leaderStar.y = -2
        island.addChild(leaderStar)
      }

      if (city) {
        const label = new PIXI.Text(city.name, {
          fontFamily: "Amiri, Georgia, serif",
          fontSize: city.isLeader ? 12 : 10,
          fill: city.isLeader ? 0xC9A84C : 0xD4B483,
        })
        label.anchor.set(0.5)
        label.y = OCT_H + 12
        island.addChild(label)
      }

      island.eventMode = "static"
      island.cursor = "pointer"
      island.on("pointerover", (e) => {
        top.tint = city ? 0xFFF3B0 : 0x5D7391
        if (city) setTooltip({ x: e.global.x, y: e.global.y - 40, text: `${city.name} — ${city.tier}` })
      })
      island.on("pointerout", () => {
        top.tint = 0xFFFFFF
        setTooltip(null)
      })
      island.on("pointerdown", (e) => {
        if (city) {
          setSelectedCity({ id: city.id, name: city.name, x: e.global.x, y: e.global.y })
          setApplyPrompt(null)
        } else {
          setApplyPrompt({ x: e.global.x, y: e.global.y })
          setSelectedCity(null)
        }
      })

      worldContainer.addChild(island)
      tileRefs.push({ city, foam, top })

      if (city) {
        islandContainersRef.current[city.id] = { island, worldLayer, top }
      }
    }

    let t = 0
    let dragging = false
    let dragStart = { x: 0, y: 0 }
    let worldStart = { x: worldContainer.x, y: worldContainer.y }
    let zoomPointer = { x: app.screen.width / 2, y: app.screen.height / 2 }
    const velocity = { x: 0, y: 0 }
    let lastDrag = { x: 0, y: 0, t: 0 }
    const pressedKeys = new Set()

    app.stage.eventMode = "static"
    app.stage.hitArea = app.screen
    app.stage.on("pointerdown", (e) => {
      dragging = true
      dragStart = { x: e.global.x, y: e.global.y }
      worldStart = { x: worldContainer.x, y: worldContainer.y }
      velocity.x = 0
      velocity.y = 0
      lastDrag = { x: e.global.x, y: e.global.y, t: performance.now() }
    })
    app.stage.on("pointermove", (e) => {
      zoomPointer = { x: e.global.x, y: e.global.y }
      if (!dragging) return
      worldContainer.x = worldStart.x + (e.global.x - dragStart.x)
      worldContainer.y = worldStart.y + (e.global.y - dragStart.y)
      const now = performance.now()
      const dt = Math.max(1, now - lastDrag.t)
      velocity.x = (e.global.x - lastDrag.x) / dt
      velocity.y = (e.global.y - lastDrag.y) / dt
      lastDrag = { x: e.global.x, y: e.global.y, t: now }
      setTooltip((prev) => (prev ? { ...prev, x: e.global.x, y: e.global.y - 40 } : prev))
    })
    app.stage.on("pointerup", () => { dragging = false })
    app.stage.on("pointerupoutside", () => { dragging = false })

    function applyZoom(scaleFactor, px, py) {
      const oldScale = worldContainer.scale.x
      const newScale = Math.max(0.35, Math.min(2.5, oldScale * scaleFactor))
      const wx = (px - worldContainer.x) / oldScale
      const wy = (py - worldContainer.y) / oldScale
      worldContainer.scale.set(newScale)
      worldContainer.x = px - wx * newScale
      worldContainer.y = py - wy * newScale
    }

    app.view.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault()
        const rect = app.view.getBoundingClientRect()
        applyZoom(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top)
      },
      { passive: false }
    )

    function onKeyDown(e) {
      pressedKeys.add(e.key)
      if (e.key === "+" || e.key === "=") applyZoom(1.1, zoomPointer.x, zoomPointer.y)
      if (e.key === "-" || e.key === "_") applyZoom(0.9, zoomPointer.x, zoomPointer.y)
    }
    function onKeyUp(e) {
      pressedKeys.delete(e.key)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)

    app.ticker.add(() => {
      t++
      waterFilter.uniforms.uTime = t * 0.016

      if (!dragging) {
        worldContainer.x += velocity.x * 16
        worldContainer.y += velocity.y * 16
        velocity.x *= 0.92
        velocity.y *= 0.92
      }

      if (pressedKeys.has("ArrowRight")) worldContainer.x += 8
      if (pressedKeys.has("ArrowLeft")) worldContainer.x -= 8
      if (pressedKeys.has("ArrowUp")) worldContainer.y -= 8
      if (pressedKeys.has("ArrowDown")) worldContainer.y += 8

      if (leaderRing) {
        const pulse = 1 + 0.08 * Math.sin((t / 180) * Math.PI * 2)
        leaderRing.scale.set(pulse, pulse)
        leaderRing.alpha = 0.45 + 0.35 * ((Math.sin((t / 180) * Math.PI * 2) + 1) / 2)
      }
      if (leaderStar) leaderStar.rotation += (Math.PI * 2) / (20 * 60)

      tileRefs.forEach(({ foam }) => {
        foam.alpha = 0.2 + Math.sin(t * 0.03) * 0.08
      })
    })

    return () => {
      isMounted.current = false
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      app.destroy(true, { children: true })
    }
  }, [navigate])

  useEffect(() => {
    for (const [cityIdStr, data] of Object.entries(worldDataMap)) {
      const cityId = Number(cityIdStr)
      const refs = islandContainersRef.current[cityId]
      if (!refs) continue

      const { worldLayer, top } = refs

      worldLayer.removeChildren()

      const voxelContainer = renderWorldIsometric(
        data.topBlocks,
        data.width,
        OCT_W,
        OCT_H,
        CITIES.find((c) => c.id === cityId)?.color || 0x1A3A2A
      )

      const mask = createOctagonMask(OCT_W * 0.92, OCT_H * 0.92)
      worldLayer.addChild(mask)
      voxelContainer.mask = mask

      worldLayer.addChild(voxelContainer)

      top.alpha = 0.15
    }
  }, [worldDataMap])

  return (
    <div
      style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mca,.schematic,.schem,.zip"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />

      {/* HEADER BAR */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "54px", zIndex: 20,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px",
          background: "linear-gradient(to bottom, rgba(10,22,40,0.85) 0%, rgba(10,22,40,0.45) 65%, transparent 100%)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: "#D4B483", fontFamily: "Amiri, Georgia, serif", direction: "rtl",
        }}
      >
        {/* Right Group */}
        <div style={{ display: "flex", alignItems: "center", gap: "18px", flex: 1, justifyContent: "flex-start" }}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/profile"); }}
            style={{
              width: 30, height: 30, borderRadius: "6px",
              border: "1px solid rgba(201,168,76,0.5)",
              background: "rgba(201,168,76,0.08)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
            title="الملف الشخصي"
          >
            <span style={{ color: "#C9A84C", fontSize: "18px", lineHeight: 1 }}></span>
          </button>
          <button onClick={() => navigate("/agora")} onMouseEnter={() => setHoveredBtn("agora")} onMouseLeave={() => setHoveredBtn(null)} style={btnStyle("agora")}>المنتدى</button>
          <button onClick={() => navigate("/school")} onMouseEnter={() => setHoveredBtn("school")} onMouseLeave={() => setHoveredBtn(null)} style={btnStyle("school")}>المدرسة</button>
        </div>

        {/* Center Emblem */}
        <div style={{ width: "64px", height: "64px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={emblemSrc} alt="Emblem" style={{ width: "100%", height: "100%" }} />
        </div>

        {/* Left Group */}
        <div style={{ display: "flex", alignItems: "center", gap: "18px", flex: 1, justifyContent: "flex-end" }}>
          <button onClick={() => navigate("/news")} onMouseEnter={() => setHoveredBtn("news")} onMouseLeave={() => setHoveredBtn(null)} style={btnStyle("news")}>الترجمان</button>
          <button onClick={() => navigate("/projects")} onMouseEnter={() => setHoveredBtn("projects")} onMouseLeave={() => setHoveredBtn(null)} style={btnStyle("projects")}>المشاريع</button>
          <button onClick={() => navigate("/rankings")} onMouseEnter={() => setHoveredBtn("rankings")} onMouseLeave={() => setHoveredBtn(null)} style={btnStyle("rankings")}>المدن</button>
        </div>
      </div>

      {/* City upload panel */}
      {selectedCity && (
        <div
          style={{
            position: "absolute",
            left: Math.min(Math.max(selectedCity.x, 160), window.innerWidth - 160),
            top: Math.max(selectedCity.y - 20, 70),
            transform: "translate(-50%, -100%)",
            background: "rgba(10,22,40,0.97)",
            border: "1px solid rgba(201,168,76,0.55)",
            borderRadius: "6px",
            padding: "14px 18px",
            zIndex: 50,
            fontFamily: "Amiri, Georgia, serif",
            color: "#D4B483",
            textAlign: "center",
            direction: "rtl",
            minWidth: "220px",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px", color: "#C9A84C" }}>
            {selectedCity.name}
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginBottom: "10px" }}>
            <button
              onClick={() => navigate(`/city/${encodeURIComponent(selectedCity.name)}`)}
              style={{
                border: "1px solid rgba(201,168,76,0.5)",
                background: "rgba(201,168,76,0.12)",
                color: "#D4B483",
                padding: "5px 12px",
                cursor: "pointer",
                fontFamily: "Amiri, Georgia, serif",
                fontSize: "12px",
                borderRadius: "4px",
              }}
            >
              دخول المدينة
            </button>
            <button
              onClick={() => {
                setUploadingCity(selectedCity.id)
                setTimeout(() => fileInputRef.current?.click(), 50)
              }}
              disabled={parseLoading}
              style={{
                border: "1px solid #C9A84C",
                background: "#C9A84C",
                color: "#0A1628",
                padding: "5px 12px",
                cursor: parseLoading ? "wait" : "pointer",
                fontFamily: "Amiri, Georgia, serif",
                fontSize: "12px",
                borderRadius: "4px",
                fontWeight: 600,
                opacity: parseLoading ? 0.6 : 1,
              }}
            >
              {parseLoading ? "جاري التحميل..." : "تحميل عالم"}
            </button>
          </div>
          <div style={{ fontSize: "10px", color: "rgba(212,180,131,0.5)" }}>
            .mca .schematic .zip
          </div>
          {worldDataMap[selectedCity.id] && (
            <div style={{ fontSize: "10px", color: "rgba(100,200,100,0.7)", marginTop: "4px" }}>
              تم تحميل العالم بنجاح
            </div>
          )}
          <button
            onClick={() => setSelectedCity(null)}
            style={{
              position: "absolute", top: "4px", left: "8px",
              background: "none", border: "none", color: "rgba(212,180,131,0.5)",
              cursor: "pointer", fontSize: "14px", padding: "2px",
            }}
          >
            x
          </button>
        </div>
      )}

      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
            background: "rgba(5,12,21,0.94)",
            color: "#D4B483",
            border: "1px solid rgba(201,168,76,0.4)",
            padding: "4px 9px",
            zIndex: 30,
            fontFamily: "Amiri, Georgia, serif",
            fontSize: "13px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {tooltip.text}
        </div>
      )}

      {parseError && (
        <div
          style={{
            position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)",
            background: "rgba(180,40,40,0.92)", color: "#fff",
            border: "1px solid rgba(255,100,100,0.5)",
            padding: "8px 16px", zIndex: 40,
            fontFamily: "Amiri, Georgia, serif", fontSize: "13px",
            borderRadius: "4px",
          }}
        >
          {parseError}
        </div>
      )}

      {applyPrompt && (
        <div
          style={{
            position: "absolute",
            left: applyPrompt.x,
            top: applyPrompt.y,
            transform: "translate(-50%, -110%)",
            background: "rgba(10,22,40,0.97)",
            border: "1px solid rgba(201,168,76,0.55)",
            padding: "10px 12px",
            zIndex: 35,
            fontFamily: "Amiri, Georgia, serif",
            color: "#D4B483",
            textAlign: "center",
          }}
        >
          <div style={{ marginBottom: "8px" }}>أسّس مدينتك هنا</div>
          <button
            onClick={() => navigate("/apply")}
            style={{
              border: "1px solid #C9A84C",
              background: "#C9A84C",
              color: "#0A1628",
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            تقديم الطلب
          </button>
        </div>
      )}

      <div ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}

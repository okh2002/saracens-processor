import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import * as THREE from "three"
import { createNoise2D } from "simplex-noise"

const CANVAS_SIZE = 800
const GRID_SIZE = 256
const CELL_SIZE = CANVAS_SIZE / GRID_SIZE
const CENTER = CANVAS_SIZE / 2
const OUTER_RADIUS = 340
const SEA_MARGIN = 120
const INNER_RADIUS = OUTER_RADIUS - SEA_MARGIN
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)

const BRUSHES = [
  { id: "raise", label: "رفع" },
  { id: "lower", label: "خفض" },
  { id: "smooth", label: "تنعيم" },
  { id: "plateau", label: "هضبة" },
  { id: "erode", label: "تعرية" },
]

const PRESETS = [
  { id: "flat", label: "السهل المنبسط" },
  { id: "rolling", label: "التلال المتدرجة" },
  { id: "coastal", label: "الجروف الساحلية" },
  { id: "mountain", label: "سلسلة الجبال" },
  { id: "river", label: "دلتا النهر" },
  { id: "desert", label: "هضبة الصحراء" },
]

function octagonVertices(radius) {
  return [...Array(8).keys()].map((i) => {
    const angle = (Math.PI / 4) * i - Math.PI / 8
    return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) }
  })
}

function pointInPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x
    const yi = points[i].y
    const xj = points[j].x
    const yj = points[j].y
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function heightToColor(height) {
  const deep = [10, 22, 40]
  const sand = [212, 180, 131]
  const stone = [232, 224, 208]
  const white = [255, 255, 255]
  if (height < 0.5) {
    const t = smoothstep(height / 0.5)
    return [Math.round(mix(deep[0], sand[0], t)), Math.round(mix(deep[1], sand[1], t)), Math.round(mix(deep[2], sand[2], t))]
  }
  if (height < 0.85) {
    const t = smoothstep((height - 0.5) / 0.35)
    return [Math.round(mix(sand[0], stone[0], t)), Math.round(mix(sand[1], stone[1], t)), Math.round(mix(sand[2], stone[2], t))]
  }
  const t = smoothstep((height - 0.85) / 0.15)
  return [Math.round(mix(stone[0], white[0], t)), Math.round(mix(stone[1], white[1], t)), Math.round(mix(stone[2], white[2], t))]
}

export default function TerrainPainterCore() {
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const previewRef = useRef(null)
  const heightmapRef = useRef(new Float32Array(GRID_SIZE * GRID_SIZE))
  const undoStackRef = useRef([])
  const paintingRef = useRef(false)
  const debounceRef = useRef(null)
  const threeRefs = useRef({ mesh: null, frameId: null })
  const seaPhaseRef = useRef(0)
  const [activeBrush, setActiveBrush] = useState("raise")
  const [brushSizes, setBrushSizes] = useState({ raise: 34, lower: 34, smooth: 44, plateau: 48, erode: 36 })
  const [renderTick, setRenderTick] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [downloadUrl, setDownloadUrl] = useState("")
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })

  const masks = useMemo(() => {
    const outer = octagonVertices(OUTER_RADIUS)
    const inner = octagonVertices(INNER_RADIUS)
    const outerMask = new Uint8Array(GRID_SIZE * GRID_SIZE)
    const seaMask = new Uint8Array(GRID_SIZE * GRID_SIZE)
    const landMask = new Uint8Array(GRID_SIZE * GRID_SIZE)
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = y * GRID_SIZE + x
        const px = x * CELL_SIZE + CELL_SIZE / 2
        const py = y * CELL_SIZE + CELL_SIZE / 2
        const inOuter = pointInPolygon(px, py, outer)
        const inInner = pointInPolygon(px, py, inner)
        outerMask[i] = inOuter ? 1 : 0
        seaMask[i] = inOuter && !inInner ? 1 : 0
        landMask[i] = inInner ? 1 : 0
      }
    }
    return { outerMask, seaMask, landMask }
  }, [])

  function drawCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    seaPhaseRef.current += 0.05
    const { outerMask, seaMask, landMask } = masks
    const data = heightmapRef.current
    ctx.fillStyle = "#040913"
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = y * GRID_SIZE + x
        if (!outerMask[i]) ctx.fillStyle = "#02050D"
        else if (seaMask[i]) {
          const wave = 0.5 + 0.5 * Math.sin(seaPhaseRef.current + x * 0.08 + y * 0.06)
          ctx.fillStyle = `rgb(18,${Math.round(38 + wave * 24)},${Math.round(58 + wave * 32)})`
        } else if (landMask[i]) {
          const [r, g, b] = heightToColor(data[i])
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        }
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      }
    }
    const poly = octagonVertices(OUTER_RADIUS)
    ctx.beginPath()
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
    ctx.closePath()
    ctx.strokeStyle = "rgba(201,168,76,0.95)"
    ctx.lineWidth = 2
    ctx.stroke()
  }

  function schedulePreviewUpdate() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setRenderTick((v) => v + 1), 500)
  }

  function applyPreset(id) {
    const noise2D = createNoise2D()
    const { landMask } = masks
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = y * GRID_SIZE + x
        if (!landMask[i]) continue
        const nx = x / GRID_SIZE
        const ny = y / GRID_SIZE
        const ridge = 1 - Math.abs(noise2D(nx * 7.2, ny * 7.2))
        const broad = noise2D(nx * 2.2, ny * 2.2) * 0.5 + 0.5
        const detail = noise2D(nx * 10.2, ny * 10.2) * 0.5 + 0.5
        const radial = clamp01(1 - Math.hypot(nx - 0.5, ny - 0.5) * 1.8)
        if (id === "flat") heightmapRef.current[i] = clamp01(0.45 + detail * 0.08)
        if (id === "rolling") heightmapRef.current[i] = clamp01(0.35 + broad * 0.3 + detail * 0.2)
        if (id === "coastal") heightmapRef.current[i] = clamp01(0.25 + radial * 0.35 + ridge * 0.32)
        if (id === "mountain") heightmapRef.current[i] = clamp01(0.28 + broad * 0.22 + ridge * 0.55)
        if (id === "river") heightmapRef.current[i] = clamp01(0.3 + broad * 0.33 - (0.18 - Math.abs(noise2D(nx * 3, ny * 3))) * 1.8)
        if (id === "desert") heightmapRef.current[i] = clamp01(0.4 + noise2D(nx * 12.5, ny * 5.7) * 0.22 + broad * 0.16)
      }
    }
    drawCanvas()
    schedulePreviewUpdate()
    setSuccessMessage("")
  }

  function canvasToGrid(clientX, clientY) {
    const rect = canvasRef.current.getBoundingClientRect()
    const x = ((clientX - rect.left) * CANVAS_SIZE) / rect.width
    const y = ((clientY - rect.top) * CANVAS_SIZE) / rect.height
    return { gx: Math.floor(x / CELL_SIZE), gy: Math.floor(y / CELL_SIZE) }
  }

  function paintAt(gx, gy) {
    const source = new Float32Array(heightmapRef.current)
    const radius = Math.max(1, Math.round(brushSizes[activeBrush] / CELL_SIZE))
    const radiusSq = radius * radius
    const { landMask } = masks
    let plateauSum = 0
    let plateauCount = 0
    if (activeBrush === "plateau") {
      for (let y = Math.max(0, gy - radius); y <= Math.min(GRID_SIZE - 1, gy + radius); y++) {
        for (let x = Math.max(0, gx - radius); x <= Math.min(GRID_SIZE - 1, gx + radius); x++) {
          const dx = x - gx
          const dy = y - gy
          if (dx * dx + dy * dy > radiusSq) continue
          const i = y * GRID_SIZE + x
          if (!landMask[i]) continue
          plateauSum += source[i]
          plateauCount++
        }
      }
    }
    const plateauTarget = plateauCount ? plateauSum / plateauCount : 0.5
    for (let y = Math.max(0, gy - radius); y <= Math.min(GRID_SIZE - 1, gy + radius); y++) {
      for (let x = Math.max(0, gx - radius); x <= Math.min(GRID_SIZE - 1, gx + radius); x++) {
        const dx = x - gx
        const dy = y - gy
        const distSq = dx * dx + dy * dy
        if (distSq > radiusSq) continue
        const i = y * GRID_SIZE + x
        if (!landMask[i]) continue
        const f = smoothstep(1 - Math.sqrt(distSq) / radius)
        if (activeBrush === "raise") heightmapRef.current[i] = clamp01(source[i] + 0.025 * f)
        if (activeBrush === "lower") heightmapRef.current[i] = clamp01(source[i] - 0.025 * f)
        if (activeBrush === "plateau") heightmapRef.current[i] = clamp01(mix(source[i], plateauTarget, 0.95 * f))
        if (activeBrush === "smooth") heightmapRef.current[i] = clamp01(mix(source[i], (source[i] + source[Math.max(0, i - 1)] + source[Math.min(source.length - 1, i + 1)]) / 3, 0.8 * f))
        if (activeBrush === "erode") {
          const rand = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7) * 43758.5453
          heightmapRef.current[i] = clamp01(source[i] - 0.011 * f + (rand - Math.floor(rand) - 0.5) * 0.018 * f)
        }
      }
    }
    drawCanvas()
  }

  useEffect(() => {
    applyPreset("flat")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const mount = previewRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(520, 520)
    renderer.setClearColor(0x0a1628)
    mount.innerHTML = ""
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 8, 10)
    camera.lookAt(0, 0, 0)
    scene.add(new THREE.AmbientLight(0xffffff, 0.62))
    const sun = new THREE.DirectionalLight(0xffe8c2, 1.05)
    sun.position.set(-6, 10, 4)
    scene.add(sun)
    const geometry = new THREE.PlaneGeometry(10, 10, GRID_SIZE - 1, GRID_SIZE - 1)
    geometry.rotateX(-Math.PI / 2)
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(GRID_SIZE * GRID_SIZE * 3), 3))
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    threeRefs.current.mesh = mesh
    const loop = () => {
      mesh.rotation.y += 0.001
      renderer.render(scene, camera)
      threeRefs.current.frameId = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      if (threeRefs.current.frameId) cancelAnimationFrame(threeRefs.current.frameId)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [])

  useEffect(() => {
    const mesh = threeRefs.current.mesh
    if (!mesh) return
    const { landMask, seaMask } = masks
    const pos = mesh.geometry.attributes.position
    const colors = mesh.geometry.attributes.color
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = y * GRID_SIZE + x
        let h = -0.3
        let color = new THREE.Color(0x040913)
        if (seaMask[i]) {
          h = -0.02
          color = new THREE.Color(0x123A63)
        } else if (landMask[i]) {
          h = heightmapRef.current[i] * 1.05
          const [r, g, b] = heightToColor(heightmapRef.current[i])
          color = new THREE.Color(r / 255, g / 255, b / 255)
        }
        pos.setY(i, h)
        colors.setXYZ(i, color.r, color.g, color.b)
      }
    }
    pos.needsUpdate = true
    colors.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }, [renderTick, masks])

  useEffect(() => {
    const drawLoop = () => {
      drawCanvas()
      requestAnimationFrame(drawLoop)
    }
    drawLoop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onUp = () => {
      if (!paintingRef.current) return
      paintingRef.current = false
      schedulePreviewUpdate()
    }
    window.addEventListener("pointerup", onUp)
    return () => window.removeEventListener("pointerup", onUp)
  })

  async function handleGenerateWorld() {
    setIsGenerating(true)
    setSuccessMessage("")
    
    try {
      // Convert heightmap to 256x256 array
      const heightmap = []
      for (let y = 0; y < 256; y++) {
        const row = []
        for (let x = 0; x < 256; x++) row.push(Number(heightmapRef.current[y * GRID_SIZE + x].toFixed(3)))
        heightmap.push(row)
      }
      
      // Get city info from session/localStorage (assuming it's stored there)
      const cityData = JSON.parse(localStorage.getItem('currentCity') || '{}')
      const city_id = cityData.id || 'default-city'
      const city_name = cityData.name || 'Saracens City'
      
      const response = await fetch(`${import.meta.env.VITE_PROCESSOR_URL}/generate-world`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          heightmap,
          city_id,
          city_name
        })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setSuccessMessage("تم توليد العالم بنجاح!")
        setDownloadUrl(result.download_url)
      } else {
        setSuccessMessage("حدث خطأ أثناء التوليد، حاول مرة أخرى")
      }
    } catch (error) {
      console.error('Error generating world:', error)
      setSuccessMessage("حدث خطأ أثناء التوليد، حاول مرة أخرى")
    }
    
    setIsGenerating(false)
  }

  return (
    <div className="min-h-screen bg-water text-sand p-6" dir="rtl" style={{ fontFamily: "Amiri, Georgia, serif" }}>
      <div className="flex items-center justify-between border-b border-gold/40 pb-3 mb-5">
        <button onClick={() => navigate("/matrix")} className="text-gold text-2xl px-3 py-1 hover:bg-gold/10 transition">←</button>
        <h1 className="text-gold text-4xl text-center">السراسنة — رسام تضاريس الجزيرة</h1>
        <div className="w-10" />
      </div>
      <div className="flex flex-col xl:flex-row gap-6 items-start justify-center">
        <div className="w-full xl:w-auto relative">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onPointerDown={(e) => {
              const { gx, gy } = canvasToGrid(e.clientX, e.clientY)
              const i = gy * GRID_SIZE + gx
              if (i < 0 || i >= GRID_SIZE * GRID_SIZE || !masks.landMask[i]) return
              undoStackRef.current.push(new Float32Array(heightmapRef.current))
              if (undoStackRef.current.length > 10) undoStackRef.current.shift()
              paintingRef.current = true
              setSuccessMessage("")
              paintAt(gx, gy)
            }}
            onPointerMove={(e) => {
              const rect = canvasRef.current.getBoundingClientRect()
              const x = e.clientX - rect.left
              const y = e.clientY - rect.top
              setCursor({ x, y, visible: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height })
              if (!paintingRef.current) return
              const { gx, gy } = canvasToGrid(e.clientX, e.clientY)
              paintAt(gx, gy)
            }}
            onPointerLeave={() => setCursor((prev) => ({ ...prev, visible: false }))}
            className="w-full max-w-[800px] aspect-square border border-gold/35 bg-[#03070F] cursor-none"
          />
          {cursor.visible && <div style={{ position: "absolute", left: cursor.x, top: cursor.y, width: brushSizes[activeBrush] * 2, height: brushSizes[activeBrush] * 2, border: "1px solid rgba(201,168,76,0.95)", borderRadius: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />}
        </div>
        <div className="w-full xl:w-[520px] space-y-4">
          <div className="border border-gold/25 bg-[#0D1E34] p-4">
            <h2 className="text-gold text-xl mb-3">أدوات الفرشاة</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {BRUSHES.map((brush) => (
                <button key={brush.id} onClick={() => setActiveBrush(brush.id)} className="px-4 py-2 border transition" style={{ borderColor: activeBrush === brush.id ? "#C9A84C" : "rgba(201,168,76,0.35)", color: activeBrush === brush.id ? "#0A1628" : "#D4B483", background: activeBrush === brush.id ? "#C9A84C" : "transparent" }}>{brush.label}</button>
              ))}
            </div>
            <label className="block mb-2">حجم الفرشاة: {brushSizes[activeBrush]}px</label>
            <input type="range" min="5" max="80" value={brushSizes[activeBrush]} onChange={(e) => setBrushSizes((prev) => ({ ...prev, [activeBrush]: Number(e.target.value) }))} className="w-full accent-[#C9A84C]" />
          </div>
          <div className="border border-gold/25 bg-[#0D1E34] p-4">
            <h2 className="text-gold text-xl mb-3">قوالب التضاريس</h2>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button key={preset.id} onClick={() => applyPreset(preset.id)} className="px-3 py-2 border border-gold/55 text-sand hover:bg-gold hover:text-water transition text-right">{preset.label}</button>
              ))}
            </div>
            <button
              onClick={() => {
                if (!undoStackRef.current.length) return
                heightmapRef.current = new Float32Array(undoStackRef.current.pop())
                drawCanvas()
                schedulePreviewUpdate()
              }}
              className="mt-3 w-full border border-gold/55 py-2 text-gold hover:bg-gold/10 transition"
            >
              تراجع (آخر 10 ضربات)
            </button>
          </div>
          <div className="border border-gold/25 bg-[#0D1E34] p-4">
            <h2 className="text-gold text-xl mb-3">معاينة ثلاثية الأبعاد</h2>
            <div ref={previewRef} className="w-[520px] max-w-full overflow-hidden border border-gold/25" />
          </div>
        </div>
      </div>
      <div className="mt-8 w-full max-w-[1320px] mx-auto">
        {!downloadUrl ? (
          <button onClick={handleGenerateWorld} disabled={isGenerating} className="w-full py-4 border border-gold text-xl transition flex justify-center items-center gap-3" style={{ backgroundColor: isGenerating ? "rgba(201,168,76,0.15)" : "#C9A84C", color: isGenerating ? "#D4B483" : "#0A1628", cursor: isGenerating ? "not-allowed" : "pointer" }}>
            {isGenerating && <span className="inline-block h-4 w-4 border-2 border-[#0A1628] border-t-transparent rounded-full animate-spin" />}
            {isGenerating ? "جاري توليد العالم..." : "توليد العالم"}
          </button>
        ) : (
          <a href={downloadUrl} download className="w-full py-4 border border-gold text-xl transition flex justify-center items-center gap-3 text-center" style={{ backgroundColor: "#C9A84C", color: "#0A1628" }}>
            تحميل العالم
          </a>
        )}
        {successMessage && <p className="mt-3 text-center text-gold text-lg">{successMessage}</p>}
      </div>
    </div>
  )
}

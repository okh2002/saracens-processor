import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import * as PIXI from "pixi.js"
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

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

const CITIES = [
  { id: 0, name: "مدينة القائد", color: 0x1A3A2A, isLeader: true, tier: "القائد" },
  { id: 1, name: "مدينة الفجر", color: 0x1A2A3A, isAsateen: true, tier: "الأساة" },
  { id: 2, name: "مدينة الصخر", color: 0x2A1A1A, isAsateen: true, tier: "الأساة" },
  { id: 3, name: "مدينة النور", color: 0x1A2A1A, isAsateen: true, tier: "الأساة" },
  { id: 4, name: "مدينة الريح", color: 0x2A1A2A, isAsateen: true, tier: "الأساة" },
]

export default function MatrixPage() {
  const canvasRef = useRef(null)
  const navigate = useNavigate()
  const [tooltip, setTooltip] = useState(null)
  const [applyPrompt, setApplyPrompt] = useState(null)
  const [cities, setCities] = useState(CITIES)

  useEffect(() => {
    // Load cities from Supabase
    async function loadCities() {
      try {
        const { data, error } = await supabase
          .from('cities')
          .select('*')
          .order('id')
        
        if (error) {
          console.error('Error loading cities:', error)
          return
        }
        
        if (data && data.length > 0) {
          const updatedCities = CITIES.map(baseCity => {
            const cityData = data.find(c => c.id === baseCity.id)
            return cityData ? { ...baseCity, ...cityData } : baseCity
          })
          setCities(updatedCities)
        }
      } catch (error) {
        console.error('Error in loadCities:', error)
      }
    }
    
    loadCities()
    
    // Subscribe to city changes
    const subscription = supabase
      .channel('cities-changes')
      .on('postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'cities' },
        (payload) => {
          setCities(prevCities => 
            prevCities.map(city => 
              city.id === payload.new.id 
                ? { ...city, ...payload.new }
                : city
            )
          )
        }
      )
      .subscribe()
    
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return

    const app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0A1628,
      antialias: true,
      resizeTo: window,
    })
    canvasRef.current.innerHTML = ""
    canvasRef.current.appendChild(app.view)

    const water = new PIXI.Sprite(PIXI.Texture.WHITE)
    water.width = app.screen.width
    water.height = app.screen.height

    // Realistic water shader with depth-based shoreline interaction
    const waterShader = `
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uIslandCount;
      uniform vec3 uIslands[32];

      // Simplex noise for organic wave patterns
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
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
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
          value += amplitude * snoise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main(void){
        vec2 uv = vTextureCoord;
        vec2 p = uv * uResolution;
        float t = uTime;

        // Calculate distance to nearest island and water depth
        float minDist = 9999.0;
        float shoreDist = 9999.0;
        float inShore = 0.0;

        for(int i = 0; i < 32; i++){
          if(float(i) >= uIslandCount) continue;
          vec2 c = uIslands[i].xy;
          float r = uIslands[i].z;
          float d = distance(p, c);
          float dist = d - r;

          if(dist < minDist) minDist = dist;
          if(abs(dist) < shoreDist) shoreDist = abs(dist);

          // Shore foam: strong where water is shallow near island edges
          float foamWidth = 28.0;
          float foam = smoothstep(foamWidth, 0.0, abs(dist));
          // Only foam on the water side (outside the island)
          foam *= smoothstep(-5.0, foamWidth * 0.5, dist);
          inShore += foam;
        }
        inShore = clamp(inShore, 0.0, 1.0);

        // Multi-directional waves with noise
        float wave1 = sin(p.x * 0.014 + t * 1.6) * 0.5 + 0.5;
        float wave2 = sin(p.y * 0.018 - t * 1.2) * 0.5 + 0.5;
        float wave3 = sin((p.x + p.y) * 0.011 + t * 0.9) * 0.5 + 0.5;
        float noise = fbm(p * 0.006 + t * 0.08) * 0.5 + 0.5;

        // Waves refract/slow near islands (shallow water effect)
        float depthFactor = smoothstep(-40.0, 80.0, minDist);
        float waveSpeed = mix(0.3, 1.0, depthFactor);
        float waveHeight = mix(0.15, 1.0, depthFactor);

        float combinedWaves = (wave1 * 0.25 + wave2 * 0.2 + wave3 * 0.2 + noise * 0.35) * waveHeight;

        // Specular sun reflection based on wave normals
        vec2 lightDir = normalize(vec2(0.6, 0.4));
        vec2 waveNormal = vec2(
          cos(p.x * 0.02 + t * 1.4) * 0.3 + noise * 0.2,
          sin(p.y * 0.016 - t * 1.1) * 0.25 + noise * 0.15
        );
        float specular = pow(max(dot(normalize(waveNormal), lightDir), 0.0), 24.0) * 0.7;

        // Water color based on depth
        vec3 deepColor = vec3(0.025, 0.065, 0.13);
        vec3 midColor = vec3(0.07, 0.19, 0.32);
        vec3 shallowColor = vec3(0.14, 0.38, 0.52);
        vec3 foamColor = vec3(0.88, 0.94, 0.96);

        // Mix colors based on distance from shore
        float shallowFactor = smoothstep(60.0, -10.0, minDist);
        vec3 waterColor = mix(deepColor, midColor, depthFactor * 0.7);
        waterColor = mix(waterColor, shallowColor, shallowFactor * 0.6);

        // Add wave brightness variation
        waterColor += vec3(0.04, 0.08, 0.12) * combinedWaves;

        // Apply shore foam (white/cyan at edges)
        waterColor = mix(waterColor, foamColor, inShore * 0.75);

        // Add sun sparkles on wave peaks
        float sparkle = pow(combinedWaves, 3.0) * specular;
        waterColor += vec3(0.9, 0.95, 1.0) * sparkle * (1.0 - inShore * 0.3);

        // Caustic patterns in shallow water
        float caustics = pow(sin(p.x * 0.035 + t * 0.9) * sin(p.y * 0.03 - t * 0.7), 2.0) * 0.06;
        caustics *= smoothstep(0.0, 50.0, minDist) * (1.0 - smoothstep(50.0, 120.0, minDist));
        waterColor += vec3(caustics * 0.5, caustics * 0.8, caustics);

        // Atmospheric distance fog
        float fog = smoothstep(0.0, 0.55, length(uv - 0.5));
        waterColor = mix(waterColor, vec3(0.04, 0.11, 0.22), fog * 0.35);

        gl_FragColor = vec4(waterColor, 1.0);
      }
    `

    const waterFilter = new PIXI.Filter(undefined, waterShader, {
      uResolution: [app.screen.width, app.screen.height],
      uTime: 0,
      uIslandCount: 0,
      uIslands: new Float32Array(32 * 3),
    })
    water.filters = [waterFilter]
    app.stage.addChild(water)

    const world = new PIXI.Container()
    world.x = app.screen.width / 2
    world.y = app.screen.height / 2 + 26
    app.stage.addChild(world)

    const tileRefs = []
    const TILE_SIZE = 48
    const GAP = 28
    let leaderRing = null
    let leaderStar = null

    for (let i = 0; i < 24; i++) {
      const pos = getTilePosition(i, TILE_SIZE, GAP)
      const iso = isoProject(pos.x, pos.y)
      const city = cities.find((c) => c.id === i)
      const island = new PIXI.Container()
      island.x = iso.x
      island.y = iso.y
      island.addChild(new PIXI.Graphics().beginFill(0x09121F, city ? 0.6 : 0.28).drawEllipse(0, 10, 46, 20).endFill())
      island.addChild(new PIXI.Graphics().beginFill(city ? 0x2A2A2A : 0x101824, city ? 0.92 : 0.42).drawEllipse(0, 2, 42, 18).endFill())
      
      // Check if city has a render_url to display isometric render
      if (city?.render_url) {
        // Load and display the isometric render
        PIXI.Texture.fromURL(city.render_url).then(texture => {
          const sprite = new PIXI.Sprite(texture)
          sprite.anchor.set(0.5)
          
          // Create octagon mask
          const mask = new PIXI.Graphics()
          const octagonPoints = []
          for (let j = 0; j < 8; j++) {
            const angle = (Math.PI / 4) * j - Math.PI / 8
            const x = Math.cos(angle) * 40
            const y = Math.sin(angle) * 16
            octagonPoints.push(x, y)
          }
          mask.beginFill(0xFFFFFF)
          mask.drawPolygon(octagonPoints)
          mask.endFill()
          
          // Apply mask and scale sprite to fit
          sprite.mask = mask
          const scale = Math.min(80 / texture.width, 32 / texture.height)
          sprite.scale.set(scale)
          
          island.addChild(mask)
          island.addChild(sprite)
        }).catch(error => {
          console.error('Error loading render texture:', error)
          // Fallback to solid color if render fails to load
          const top = new PIXI.Graphics()
          top.lineStyle(city ? (city.isLeader ? 2.4 : 1.8) : 0.8, city ? (city.isLeader ? 0xC9A84C : city.isAsateen ? 0xE1BE63 : 0xC9A84C) : 0x2B3B4E, city ? 0.9 : 0.24)
          top.beginFill(city ? city.color : 0x0D1220, city ? 0.96 : 0.25).drawEllipse(0, 0, 40, 16).endFill()
          island.addChild(top)
        })
      } else {
        // Default solid color fill for cities without renders
        const top = new PIXI.Graphics()
        top.lineStyle(city ? (city.isLeader ? 2.4 : 1.8) : 0.8, city ? (city.isLeader ? 0xC9A84C : city.isAsateen ? 0xE1BE63 : 0xC9A84C) : 0x2B3B4E, city ? 0.9 : 0.24)
        top.beginFill(city ? city.color : 0x0D1220, city ? 0.96 : 0.25).drawEllipse(0, 0, 40, 16).endFill()
        island.addChild(top)
      }
      if (city?.isLeader) {
        leaderRing = new PIXI.Graphics().lineStyle(1.8, 0xC9A84C, 0.55).drawEllipse(0, 0, 46, 20)
        island.addChild(leaderRing)
        leaderStar = new PIXI.Text("✦", { fontFamily: "Amiri, Georgia, serif", fontSize: 16, fill: 0xC9A84C })
        leaderStar.anchor.set(0.5)
        leaderStar.y = -2
        island.addChild(leaderStar)
      }
      if (city) {
        const label = new PIXI.Text(city.name, { fontFamily: "Amiri, Georgia, serif", fontSize: city.isLeader ? 12 : 10, fill: city.isLeader ? 0xC9A84C : 0xD4B483 })
        label.anchor.set(0.5)
        label.y = 24
        island.addChild(label)
      }
      island.eventMode = "static"
      island.cursor = "pointer"
      island.on("pointerover", (e) => {
        // Find the top graphics element or the sprite to highlight
        const topElement = island.children.find(child => child instanceof PIXI.Graphics && child.geometry && child.geometry.points) || 
                          island.children.find(child => child instanceof PIXI.Sprite)
        if (topElement) {
          topElement.tint = city ? 0xFFF3B0 : 0x5D7391
        }
        if (city) setTooltip({ x: e.global.x, y: e.global.y - 40, text: `${city.name} — ${city.tier}` })
      })
      island.on("pointerout", () => { 
        // Find the top graphics element or the sprite to unhighlight
        const topElement = island.children.find(child => child instanceof PIXI.Graphics && child.geometry && child.geometry.points) || 
                          island.children.find(child => child instanceof PIXI.Sprite)
        if (topElement) {
          topElement.tint = 0xFFFFFF
        }
        setTooltip(null) 
      })
      island.on("pointerdown", (e) => {
        if (city) navigate(`/city/${encodeURIComponent(city.name)}`)
        else setApplyPrompt({ x: e.global.x, y: e.global.y })
      })
      world.addChild(island)
      tileRefs.push({ city, island, radius: 44 })
    }

    let t = 0
    let dragging = false
    let dragStart = { x: 0, y: 0 }
    let worldStart = { x: world.x, y: world.y }
    let zoomPointer = { x: app.screen.width / 2, y: app.screen.height / 2 }
    const velocity = { x: 0, y: 0 }
    let lastDrag = { x: 0, y: 0, t: 0 }
    const pressedKeys = new Set()

    app.stage.eventMode = "static"
    app.stage.hitArea = app.screen
    app.stage.on("pointerdown", (e) => {
      dragging = true
      dragStart = { x: e.global.x, y: e.global.y }
      worldStart = { x: world.x, y: world.y }
      velocity.x = 0
      velocity.y = 0
      lastDrag = { x: e.global.x, y: e.global.y, t: performance.now() }
    })
    app.stage.on("pointermove", (e) => {
      zoomPointer = { x: e.global.x, y: e.global.y }
      if (!dragging) return
      world.x = worldStart.x + (e.global.x - dragStart.x)
      world.y = worldStart.y + (e.global.y - dragStart.y)
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
      const oldScale = world.scale.x
      const newScale = Math.max(0.35, Math.min(2.5, oldScale * scaleFactor))
      const worldX = (px - world.x) / oldScale
      const worldY = (py - world.y) / oldScale
      world.scale.set(newScale)
      world.x = px - worldX * newScale
      world.y = py - worldY * newScale
    }
    app.view.addEventListener("wheel", (e) => {
      e.preventDefault()
      const rect = app.view.getBoundingClientRect()
      applyZoom(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top)
    }, { passive: false })
    function onKeyDown(e) {
      pressedKeys.add(e.key)
      if (e.key === "+" || e.key === "=") applyZoom(1.1, zoomPointer.x, zoomPointer.y)
      if (e.key === "-" || e.key === "_") applyZoom(0.9, zoomPointer.x, zoomPointer.y)
    }
    function onKeyUp(e) { pressedKeys.delete(e.key) }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)

    app.ticker.add(() => {
      t++
      waterFilter.uniforms.uTime = t * 0.016
      if (!dragging) {
        world.x += velocity.x * 16
        world.y += velocity.y * 16
        velocity.x *= 0.92
        velocity.y *= 0.92
      }
      if (pressedKeys.has("ArrowRight")) world.x += 8
      if (pressedKeys.has("ArrowLeft")) world.x -= 8
      if (pressedKeys.has("ArrowUp")) world.y -= 8
      if (pressedKeys.has("ArrowDown")) world.y += 8
      if (leaderRing) {
        const pulse = 1 + 0.08 * Math.sin((t / 180) * Math.PI * 2)
        leaderRing.scale.set(pulse, pulse)
        leaderRing.alpha = 0.45 + 0.35 * ((Math.sin((t / 180) * Math.PI * 2) + 1) / 2)
      }
      if (leaderStar) leaderStar.rotation += (Math.PI * 2) / (20 * 60)
      const islands = waterFilter.uniforms.uIslands
      let count = 0
      tileRefs.forEach((tile) => {
        if (!tile.city) return
        const g = tile.island.getGlobalPosition()
        islands[count * 3] = g.x
        islands[count * 3 + 1] = g.y
        islands[count * 3 + 2] = tile.radius * world.scale.x
        count++
      })
      waterFilter.uniforms.uIslandCount = count
    })

    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      app.destroy(true, { children: true })
    }
  }, [navigate])

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "34px", borderBottom: "1px solid rgba(201,168,76,0.85)", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", background: "rgba(10,22,40,0.92)", color: "#D4B483", fontFamily: "Amiri, Georgia, serif", direction: "rtl" }}>
        <div style={{ width: "33%", textAlign: "right", color: "#C9A84C" }}>السراسنة</div>
        <div style={{ width: "34%", textAlign: "center" }}>المدن: ٥ · الأعضاء: ١٢ · التأسيس: ١٤٤٦</div>
        <div style={{ width: "33%", textAlign: "left" }}>
          <button onClick={() => navigate("/register")} style={{ color: "#C9A84C", background: "transparent", border: "1px solid rgba(201,168,76,0.5)", padding: "2px 10px", cursor: "pointer" }}>تسجيل الدخول</button>
        </div>
      </div>
      {tooltip && <div style={{ position: "absolute", left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)", background: "rgba(5,12,21,0.94)", color: "#D4B483", border: "1px solid rgba(201,168,76,0.4)", padding: "4px 9px", zIndex: 30, fontFamily: "Amiri, Georgia, serif", fontSize: "13px", pointerEvents: "none", whiteSpace: "nowrap" }}>{tooltip.text}</div>}
      {applyPrompt && (
        <div style={{ position: "absolute", left: applyPrompt.x, top: applyPrompt.y, transform: "translate(-50%, -110%)", background: "rgba(10,22,40,0.97)", border: "1px solid rgba(201,168,76,0.55)", padding: "10px 12px", zIndex: 35, fontFamily: "Amiri, Georgia, serif", color: "#D4B483", textAlign: "center" }}>
          <div style={{ marginBottom: "8px" }}>أسّس مدينتك هنا</div>
          <button onClick={() => navigate("/apply")} style={{ border: "1px solid #C9A84C", background: "#C9A84C", color: "#0A1628", padding: "4px 10px", cursor: "pointer" }}>تقديم الطلب</button>
        </div>
      )}
      <div ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}
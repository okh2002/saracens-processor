import { useState } from "react"
import { useNavigate } from "react-router-dom"

export default function RegisterPage() {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({
    username: "", email: "", password: "", confirmPassword: "", skin: null, skinPreview: null
  })
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value })

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.type !== "image/png") {
      setErrors(p => ({ ...p, skin: "يجب أن يكون الملف بصيغة PNG فقط" }))
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        if (img.width !== 64 || img.height !== 64) {
          setErrors(p => ({ ...p, skin: "يجب أن تكون الصورة بالضبط 64x64 بكسل" }))
          return
        }

        // 1. Source canvas (64x64 skin)
        const src = document.createElement("canvas")
        src.width = 64; src.height = 64
        const sCtx = src.getContext("2d")
        sCtx.drawImage(img, 0, 0)

        // 2. Layout canvas (16x16: head + shoulders)
        const layout = document.createElement("canvas")
        layout.width = 16; layout.height = 16
        const lCtx = layout.getContext("2d")
        lCtx.imageSmoothingEnabled = false

        // 3. Composite BASE + OUTER layers for all parts
        // Head
        lCtx.drawImage(src, 8, 8, 8, 8, 4, 2, 8, 8)     // Base head
        lCtx.drawImage(src, 40, 8, 8, 8, 4, 2, 8, 8)    // Outer head (hat)
        
        // Torso
        lCtx.drawImage(src, 20, 20, 8, 6, 4, 10, 8, 6)  // Base torso top
        lCtx.drawImage(src, 20, 36, 8, 6, 4, 10, 8, 6)  // Outer torso (jacket)
        
        // Left Arm
        lCtx.drawImage(src, 44, 20, 4, 6, 0, 10, 4, 6)  // Base left arm
        lCtx.drawImage(src, 52, 52, 4, 6, 0, 10, 4, 6)  // Outer left arm (sleeve)
        
        // Right Arm
        lCtx.drawImage(src, 36, 52, 4, 6, 12, 10, 4, 6) // Base right arm
        lCtx.drawImage(src, 44, 52, 4, 6, 12, 10, 4, 6) // Outer right arm (sleeve)

        // 4. Output canvas (80x80, scaled with strict nearest-neighbor)
        const out = document.createElement("canvas")
        out.width = 80; out.height = 80
        const oCtx = out.getContext("2d")
        oCtx.imageSmoothingEnabled = false
        oCtx.drawImage(layout, 0, 0, 16, 16, 0, 0, 80, 80)

        setFormData(p => ({ ...p, skin: file, skinPreview: out.toDataURL() }))
        setErrors(p => ({ ...p, skin: "" }))
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  const validate = () => {
    const e = {}
    if (!formData.username || /\s/.test(formData.username) || formData.username.length < 3 || formData.username.length > 20)
      e.username = "من 3 إلى 20 حرفًا، بدون مسافات"
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      e.email = "أدخل بريدًا إلكترونيًا صالحًا"
    if (!formData.password || formData.password.length < 8)
      e.password = "8 أحرف على الأقل"
    if (formData.password !== formData.confirmPassword)
      e.confirmPassword = "كلمتا المرور غير متطابقتين"
    if (!formData.skin)
      e.skin = "صورة الشخصية مطلوبة"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (validate()) {
      console.log({ username: formData.username, email: formData.email, skin: formData.skin?.name })
      setSuccess(true)
    }
  }

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "#0A1628",
      display: "flex", justifyContent: "center", alignItems: "center",
      fontFamily: "Amiri, Georgia, serif", direction: "rtl",
      overflow: "hidden"
    }}>
      <style>{`
        .reg-input {
          background: transparent; color: #D4B483; border: none;
          border-bottom: 1px solid rgba(201,168,76,0.15);
          padding: 8px 0; width: 100%; font-family: inherit; font-size: 15px;
          outline: none; transition: all 0.2s ease; box-sizing: border-box;
        }
        .reg-input:focus { border-bottom-color: #C9A84C; box-shadow: 0 1px 6px rgba(201,168,76,0.1); }
        .reg-input::placeholder { color: #4A4035; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity: 0.6; text-shadow: none; } 50% { opacity: 1; text-shadow: 0 0 16px rgba(201,168,76,0.5); } }
        .reg-card { animation: fadeUp 0.35s ease-out forwards; }
        .submit-btn {
          width: 100%; height: 42px; background: linear-gradient(135deg, #C9A84C, #B8963C);
          color: #0A1628; border: none; cursor: pointer; font-family: inherit; font-size: 16px;
          transition: all 0.2s ease; margin-top: 12px;
        }
        .submit-btn:hover { background: linear-gradient(135deg, #B8963C, #C9A84C); transform: translateY(-1px); }
      `}</style>

      <div className="reg-card" style={{
        maxWidth: "360px", width: "92%",
        background: "#0C1B2E", borderLeft: "3px solid #C9A84C",
        padding: "24px 20px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        boxSizing: "border-box"
      }}>
        {success ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ color: "#C9A84C", fontSize: "44px", marginBottom: "12px", animation: "pulse 2s ease-in-out infinite" }}>✦</div>
            <p style={{ color: "#D4B483", fontSize: "18px", margin: "0 0 20px" }}>مرحباً بك في السراسنة</p>
            <button onClick={() => navigate("/matrix")} className="submit-btn">ادخل الأمة</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            
            {/* ── Skin Preview (Clickable) ── */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ cursor: "pointer", display: "block", position: "relative" }}>
                {formData.skinPreview ? (
                  <img src={formData.skinPreview} alt="skin" style={{
                    width: "68px", height: "68px", imageRendering: "pixelated",
                    border: "2px solid #C9A84C", display: "block", transition: "transform 0.2s, box-shadow 0.2s"
                  }} onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(201,168,76,0.35)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 0 rgba(201,168,76,0)"; }} />
                ) : (
                  <div style={{
                    width: "68px", height: "68px", border: "1.5px dashed rgba(201,168,76,0.35)",
                    background: "rgba(201,168,76,0.02)", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "border-color 0.2s, background 0.2s"
                  }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#C9A84C"; e.currentTarget.style.background = "rgba(201,168,76,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)"; e.currentTarget.style.background = "rgba(201,168,76,0.02)"; }}>
                    <svg width="38" height="38" viewBox="0 0 56 56">
                      <polygon points="18,4 38,4 52,18 52,38 38,52 18,52 4,38 4,18" fill="transparent" stroke="rgba(201,168,76,0.25)" strokeWidth="1" />
                      <text x="28" y="34" textAnchor="middle" fill="#4A4035" fontFamily="Georgia, serif" fontSize="20">+</text>
                    </svg>
                  </div>
                )}
                <input type="file" accept="image/png" onChange={handleFileChange} style={{ display: "none" }} />
              </label>
              {errors.skin && <p style={{ color: "#c0604a", fontSize: "11px", marginTop: "4px", textAlign: "center" }}>{errors.skin}</p>}
            </div>

            {/* ── Divider ── */}
            <div style={{ height: "1px", background: "linear-gradient(to left, transparent, rgba(201,168,76,0.15), transparent)", margin: "4px 0 8px" }} />

            {/* ── Fields ── */}
            <div>
              <label style={{ color: "#8A7D65", fontSize: "11px", display: "block", marginBottom: "3px" }}>اسم المستخدم</label>
              <input name="username" value={formData.username} onChange={handleChange} placeholder="أدخل اسم المستخدم" className="reg-input" />
              {errors.username && <p style={{ color: "#c0604a", fontSize: "10px", marginTop: "2px" }}>{errors.username}</p>}
            </div>

            <div>
              <label style={{ color: "#8A7D65", fontSize: "11px", display: "block", marginBottom: "3px" }}>البريد الإلكتروني</label>
              <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="example@domain.com" className="reg-input" />
              {errors.email && <p style={{ color: "#c0604a", fontSize: "10px", marginTop: "2px" }}>{errors.email}</p>}
            </div>

            <div style={{ position: "relative" }}>
              <label style={{ color: "#8A7D65", fontSize: "11px", display: "block", marginBottom: "3px" }}>كلمة المرور</label>
              <input name="password" type={showPassword ? "text" : "password"} value={formData.password} onChange={handleChange} placeholder="••••••••" className="reg-input" style={{ paddingLeft: "40px" }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", left: 0, bottom: "8px", background: "transparent", border: "none", color: "#5A5045", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", padding: 0, transition: "color 0.2s" }} onMouseEnter={e => e.target.style.color = "#C9A84C"} onMouseLeave={e => e.target.style.color = "#5A5045"}>{showPassword ? "إخفاء" : "إظهار"}</button>
              {errors.password && <p style={{ color: "#c0604a", fontSize: "10px", marginTop: "2px" }}>{errors.password}</p>}
            </div>

            <div>
              <label style={{ color: "#8A7D65", fontSize: "11px", display: "block", marginBottom: "3px" }}>تأكيد كلمة المرور</label>
              <input name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} placeholder="أعد إدخال كلمة المرور" className="reg-input" />
              {errors.confirmPassword && <p style={{ color: "#c0604a", fontSize: "10px", marginTop: "2px" }}>{errors.confirmPassword}</p>}
            </div>

            <button type="submit" className="submit-btn">انضم إلى السراسنة</button>

            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <span style={{ color: "#4A4035", fontSize: "12px" }}>لديك حساب؟ </span>
              <button type="button" onClick={() => navigate("/login")} style={{ background: "transparent", border: "none", color: "#8A7D65", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: 0, textDecoration: "underline", transition: "color 0.2s" }} onMouseEnter={e => e.target.style.color = "#C9A84C"} onMouseLeave={e => e.target.style.color = "#8A7D65"}>سجّل دخولك</button>
            </div>

          </form>
        )}
      </div>
    </div>
  )
}
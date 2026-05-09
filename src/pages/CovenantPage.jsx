import { useNavigate } from "react-router-dom"

export default function CovenantPage() {
  const navigate = useNavigate()

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#0A1628",
      display: "flex", justifyContent: "center", alignItems: "center",
      fontFamily: "Amiri, Georgia, serif", direction: "rtl", overflow: "hidden"
    }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity: 0.6; text-shadow: none; } 50% { opacity: 1; text-shadow: 0 0 16px rgba(201,168,76,0.5); } }
        .covenant-card { animation: fadeUp 0.4s ease-out forwards; }
        .btn-primary {
          width: 100%; height: 40px; background: linear-gradient(135deg, #C9A84C, #B8963C);
          color: #0A1628; border: none; cursor: pointer; font-family: inherit; font-size: 15px;
          transition: all 0.2s ease;
        }
        .btn-primary:hover { background: linear-gradient(135deg, #B8963C, #C9A84C); transform: translateY(-1px); }
        .btn-secondary {
          width: 100%; height: 34px; background: transparent; color: #8A7D65;
          border: 1px solid rgba(201,168,76,0.25); cursor: pointer; font-family: inherit; font-size: 13px;
          transition: all 0.2s ease;
        }
        .btn-secondary:hover { border-color: rgba(201,168,76,0.5); color: #D4B483; }
      `}</style>

      <div className="covenant-card" style={{
        maxWidth: "380px", width: "90%",
        background: "#0C1B2E", borderLeft: "3px solid #C9A84C",
        padding: "20px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        textAlign: "center", boxSizing: "border-box"
      }}>
        <div style={{ color: "#C9A84C", fontSize: "32px", marginBottom: "6px", animation: "pulse 2.5s ease-in-out infinite" }}>✦</div>
        <h1 style={{ color: "#C9A84C", fontSize: "24px", margin: "0 0 10px", fontWeight: "normal" }}>السراسنة</h1>

        <div style={{ height: "1px", background: "linear-gradient(to left, transparent, rgba(201,168,76,0.15), transparent)", margin: "0 0 12px" }} />

        <div style={{ color: "#D4B483", fontSize: "14px", lineHeight: "1.85", textAlign: "justify", marginBottom: "14px", padding: "0 2px" }}>
          <p style={{ margin: "0 0 8px" }}>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>
          <p style={{ margin: "0 0 8px" }}>نحنُ جماعةٌ تسعى للعلمِ والنُّورِ، نَبنِي معًا صَرْحَ المعرفةِ على أُسُسِ الصدقِ والتَّعاونِ.</p>
          <p style={{ margin: "0 0 8px" }}>بالدُّخولِ إلى منصَّتنا، تَقبَلُ أن تَسيرَ على خُطَى الحِكمةِ، وتُعامِلَ الإخوانَ بِالرِّفقِ.</p>
          <p style={{ margin: "0" }}>فَإن كُنتَ على هذا العَهدِ، فَاهلاً وسَهلاً.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button type="button" onClick={() => navigate("/register")} className="btn-primary">
            أَقبَلُ العَهد — أَنشِئ حِسابي
          </button>

          <button type="button" onClick={() => navigate("/matrix")} className="btn-secondary">
            أَستَكشِفُ المنصَّةَ أَوَّلاً
          </button>

          <button type="button" onClick={() => navigate("/login")} style={{
            background: "transparent", border: "none", color: "#4A4035", cursor: "pointer",
            fontFamily: "inherit", fontSize: "12px", padding: "4px 0", marginTop: "2px",
            transition: "color 0.2s"
          }} onMouseEnter={e => e.target.style.color = "#C9A84C"} onMouseLeave={e => e.target.style.color = "#4A4035"}>
            لَدَيَّ حِسابٌ فَعلاً — سِجّل دُخولي
          </button>
        </div>
      </div>
    </div>
  )
}
import { Routes, Route, Navigate } from "react-router-dom"
import CovenantPage from "./pages/CovenantPage"
import RegisterPage from "./pages/RegisterPage"
import LoginPage from "./pages/LoginPage"
import MatrixPageIso from "./pages/MatrixPageIso"
import TerrainPainter from "./pages/TerrainPainter"

const Stub = ({ t }) => (
  <div style={{background:"#0A1628",height:"100vh",display:"flex",justifyContent:"center",alignItems:"center",color:"#C9A84C",fontFamily:"Amiri,serif",fontSize:"24px"}}>{t}</div>
)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CovenantPage />} />
      <Route path="/terrain" element={<TerrainPainter />} />
      <Route path="/matrix" element={<MatrixPageIso />} />
      <Route path="/city/:name" element={<MatrixPageIso />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/school" element={<Stub t="المدرسة" />} />
      <Route path="/agora" element={<Stub t="المنتدى" />} />
      <Route path="/projects" element={<Stub t="المشاريع" />} />
      <Route path="/news" element={<Stub t="الترجمان" />} />
      <Route path="/rankings" element={<Stub t="المدن" />} />
      <Route path="/profile" element={<Stub t="الملف" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
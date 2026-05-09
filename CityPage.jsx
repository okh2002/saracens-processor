import { useParams } from "react-router-dom"

export default function CityPage() {
  const { cityName } = useParams()
  return (
    <div className="min-h-screen bg-water flex items-center justify-center" dir="rtl" style={{ fontFamily: "Amiri, Georgia, serif" }}>
      <h1 className="text-gold text-5xl text-center">{decodeURIComponent(cityName || "")}</h1>
    </div>
  )
}

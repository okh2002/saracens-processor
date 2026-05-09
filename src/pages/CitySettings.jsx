import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export default function CitySettings() {
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [successMessage, setSuccessMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [currentCity, setCurrentCity] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)

  useEffect(() => {
    // Load current city data from localStorage
    const cityData = JSON.parse(localStorage.getItem('currentCity') || '{}')
    if (!cityData.id) {
      navigate('/matrix')
      return
    }
    setCurrentCity(cityData)
  }, [navigate])

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (file && file.name.endsWith('.zip')) {
      setSelectedFile(file)
      setErrorMessage("")
    } else {
      setErrorMessage("يرجى اختيار ملف بصيغة .zip فقط")
      setSelectedFile(null)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile || !currentCity) {
      setErrorMessage("يرجى اختيار ملف العالم أولاً")
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setSuccessMessage("")
    setErrorMessage("")

    try {
      const formData = new FormData()
      formData.append('world_zip', selectedFile)
      formData.append('city_id', currentCity.id)

      // Create XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest()
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          setUploadProgress(progress)
        }
      })

      return new Promise((resolve, reject) => {
        xhr.onload = async () => {
          if (xhr.status === 200) {
            const result = JSON.parse(xhr.responseText)
            
            if (result.success) {
              // Update city record in Supabase with render_url
              const { error: updateError } = await supabase
                .from('cities')
                .update({ 
                  render_url: result.render_url,
                  schematic_key: result.schematic_key
                })
                .eq('id', currentCity.id)

              if (updateError) {
                console.error('Error updating city record:', updateError)
                setErrorMessage("تم رفع العالم ولكن حدث خطأ في تحديث السجل")
              } else {
                setSuccessMessage("تم رفع العالم بنجاح — جاري توليد العرض المرئي")
                setSelectedFile(null)
                // Reset file input
                const fileInput = document.getElementById('world-upload')
                if (fileInput) fileInput.value = ''
              }
              resolve(result)
            } else {
              setErrorMessage("فشل رفع الملف: " + (result.error || "خطأ غير معروف"))
              reject(result)
            }
          } else {
            setErrorMessage(`فشل الرفع: ${xhr.status} ${xhr.statusText}`)
            reject(new Error(`HTTP ${xhr.status}`))
          }
          setUploading(false)
        }

        xhr.onerror = () => {
          setErrorMessage("حدث خطأ في الاتصال بالخادم")
          setUploading(false)
          reject(new Error('Network error'))
        }

        xhr.open('POST', `${import.meta.env.VITE_PROCESSOR_URL}/process-world-upload`)
        xhr.send(formData)
      })

    } catch (error) {
      console.error('Upload error:', error)
      setErrorMessage("حدث خطأ أثناء رفع الملف، حاول مرة أخرى")
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-water text-sand p-6" dir="rtl" style={{ fontFamily: "Amiri, Georgia, serif" }}>
      <div className="flex items-center justify-between border-b border-gold/40 pb-3 mb-5">
        <button onClick={() => navigate("/matrix")} className="text-gold text-2xl px-3 py-1 hover:bg-gold/10 transition">←</button>
        <h1 className="text-gold text-4xl text-center">إعدادات المدينة</h1>
        <div className="w-10" />
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {currentCity && (
          <div className="border border-gold/25 bg-[#0D1E34] p-4">
            <h2 className="text-gold text-xl mb-2">المدينة الحالية</h2>
            <p className="text-sand">اسم المدينة: {currentCity.name || 'غير محدد'}</p>
            <p className="text-sand">معرف المدينة: {currentCity.id}</p>
            {currentCity.render_url && (
              <div className="mt-3">
                <img 
                  src={currentCity.render_url} 
                  alt="Render of city" 
                  className="w-full max-w-md border border-gold/25"
                />
                <p className="text-gold text-sm mt-2">العرض المرئي الحالي</p>
              </div>
            )}
          </div>
        )}

        <div className="border border-gold/25 bg-[#0D1E34] p-6">
          <h2 className="text-gold text-xl mb-4">رفع العالم بعد البناء</h2>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="world-upload" className="block text-sand mb-2">
                ارفع ملف العالم بعد البناء
              </label>
              <input
                id="world-upload"
                type="file"
                accept=".zip"
                onChange={handleFileSelect}
                disabled={uploading}
                className="w-full p-3 border border-gold/35 bg-[#0A1628] text-sand file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gold file:text-water hover:file:bg-gold/90 disabled:opacity-50"
              />
              <p className="text-sand/70 text-sm mt-2">
                قم بضغط مجلد العالم من Minecraft وارفعه هنا
              </p>
            </div>

            {selectedFile && (
              <div className="text-sand">
                <p>الملف المحدد: {selectedFile.name}</p>
                <p>الحجم: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}

            {uploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sand text-sm">
                  <span>جاري الرفع...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-[#0A1628] rounded-full h-2">
                  <div 
                    className="bg-gold h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="w-full py-3 border border-gold text-lg transition flex justify-center items-center gap-3"
              style={{ 
                backgroundColor: (!selectedFile || uploading) ? "rgba(201,168,76,0.15)" : "#C9A84C", 
                color: (!selectedFile || uploading) ? "#D4B483" : "#0A1628", 
                cursor: (!selectedFile || uploading) ? "not-allowed" : "pointer" 
              }}
            >
              {uploading && (
                <span className="inline-block h-4 w-4 border-2 border-[#0A1628] border-t-transparent rounded-full animate-spin" />
              )}
              {uploading ? "جاري الرفع..." : "رفع العالم"}
            </button>

            {successMessage && (
              <div className="p-3 bg-green-900/30 border border-green-600/50 rounded text-green-300">
                {successMessage}
              </div>
            )}

            {errorMessage && (
              <div className="p-3 bg-red-900/30 border border-red-600/50 rounded text-red-300">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        <div className="border border-gold/25 bg-[#0D1E34] p-4">
          <h2 className="text-gold text-lg mb-2">ملاحظات هامة</h2>
          <ul className="text-sand text-sm space-y-1 list-disc list-inside">
            <li>تأكد من أن ملف العالم مضغوط بصيغة .zip</li>
            <li>يجب أن يحتوي الملف على مجلد العالم الكامل مع region files</li>
            <li>سيتم توليد عرض مرئي تلقائياً بعد رفع العالم</li>
            <li>قد يستغرق المعالجة بضع دقائق حسب حجم العالم</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

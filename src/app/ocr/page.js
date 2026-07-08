"use client";

import { useState, useRef, useEffect } from "react";
import QRCode from "react-qr-code";
import { Monitor, ArrowLeft, Loader2, Download, Table2, Scan, FileImage, Clock } from "lucide-react";
import { toast } from "@/components/Toast";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import TopUpModal from "@/components/TopUpModal";
import "../globals.css";
import "../home.css";

export default function OcrPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const supabase = createClient();

  const [syncSessionId, setSyncSessionId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [recentExtractions, setRecentExtractions] = useState([]);
  
  const [uploadMode, setUploadMode] = useState("file"); // "file" | "qr"

  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        fetchCredits(session.user.id);
        fetchRecentExtractions(session.user.id);
      } else {
        router.push("/");
      }
    };
    fetchSession();
  }, [router, supabase]);

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from("profiles").select("credits").eq("id", userId).single();
    if (data) setCredits(data.credits);
  };

  const fetchRecentExtractions = async (userId) => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .eq("trace_type", "ocr")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setRecentExtractions(data);
  };

  useEffect(() => {
    if (!syncSessionId && typeof window !== "undefined") {
      setSyncSessionId(crypto.randomUUID());
    }
  }, [syncSessionId]);

  useEffect(() => {
    if (!syncSessionId || !user) return; 

    const channel = supabase.channel(`ocr_mobile_sync_${syncSessionId}`)
      .on('broadcast', { event: 'image_uploaded' }, async (payload) => {
        const fileUrl = payload.payload.imageUrl;
        setPreviewImage(fileUrl);
        setSelectedUrl(fileUrl);
        setSelectedFile(null);
        setExtractedData(null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncSessionId, user, supabase]);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files?.length > 0) handleFileSelected(e.dataTransfer.files[0]);
  };

  const handleFileSelected = (file) => {
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    setPreviewImage(objUrl);
    setSelectedFile(file);
    setSelectedUrl(null);
    setExtractedData(null);
  };

  const uploadAndProcessFile = async (file) => {
    setIsProcessing(true);
    setExtractedData(null);
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error("Please log in to extract data.");

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ fileName: file.name, contentType: file.type })
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");
      
      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });
      if (!putRes.ok) throw new Error("Failed to upload image to storage");

      await processOcrFromUrl(urlData.publicUrl);
    } catch (err) {
      console.error(err);
      if (err.message === "INSUFFICIENT_CREDITS") {
        setShowTopUpModal(true);
      } else {
        toast.error(err.message || "Failed to extract text.");
      }
      setIsProcessing(false);
    }
  };

  const processOcrFromUrl = async (url) => {
    setIsProcessing(true);
    setExtractedData(null);
    try {
      const formData = new FormData();
      formData.append("imageUrl", url);
      const response = await fetch("/api/ocr-extract", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setExtractedData(result.data);
      fetchCredits(user.id);
      fetchRecentExtractions(user.id);
      toast.success("Data extracted successfully!");
    } catch (err) {
      console.error(err);
      if (err.message === "INSUFFICIENT_CREDITS") {
        setShowTopUpModal(true);
      } else {
        toast.error(err.message || "Failed to extract text.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!extractedData || extractedData.length === 0) return;
    const headers = Object.keys(extractedData[0]);
    const csvRows = [
      headers.join(","),
      ...extractedData.map(row => 
        headers.map(header => {
          let val = row[header] || "";
          if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            val = `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(",")
      )
    ];
    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "extracted_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ height: "100vh", maxHeight: "100vh", overflow: "hidden", backgroundColor: "#262626", color: "#d5d5d5", display: "flex", flexDirection: "column" }}>
      
      {/* Header */}
      <header style={{ padding: "20px 40px", display: "flex", alignItems: "center", borderBottom: "1px solid #444", background: "#1a1a1a" }}>
        <button onClick={() => router.push('/')} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: "500", transition: "color 0.2s" }} onMouseEnter={e => e.currentTarget.style.color="#FFD700"} onMouseLeave={e => e.currentTarget.style.color="#888"}>
          <ArrowLeft size={18} /> Back to Home
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: "12px" }}>
          <Table2 size={24} color="#FFD700" />
          <h1 style={{ fontSize: "20px", fontWeight: "normal", margin: 0, color: "#fff" }}>Image to CSV Extraction</h1>
        </div>
        <div style={{ width: "100px", display: "flex", justifyContent: "flex-end" }}>
          <div onClick={() => setShowTopUpModal(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "linear-gradient(135deg, #2a2a2a, #111)", padding: "6px 14px", borderRadius: "0", cursor: "pointer", border: "1px solid #444", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor = "#444"}>
            <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "13px" }}>{credits}</span>
            <span style={{ color: "#aaa", fontSize: "11px" }}>Credits</span>
          </div>
        </div>
      </header>

      {/* Main Split Content */}
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        
        {/* LEFT COLUMN: Input & Image Preview */}
        <div style={{ flex: "0 0 50%", display: "flex", flexDirection: "column", borderRight: "1px solid #444", background: "#2a2a2a", padding: "40px", overflowY: "auto" }}>
          
          {!previewImage ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
              
              <div style={{ textAlign: "center", marginBottom: "40px" }}>
                <h2 style={{ fontSize: "28px", fontWeight: "normal", margin: "0 0 15px 0", color: "#fff" }}>Extract Data with AI</h2>
                <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6" }}>Upload a picture of any list, receipt, or handwritten notes. Our AI will structure it into a spreadsheet.</p>
              </div>

              {/* Toggle Buttons */}
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "30px" }}>
                <button className="start-btn" onClick={() => setUploadMode("file")} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", borderRadius: "0", border: uploadMode === "file" ? "1px solid rgba(255,215,0,0.3)" : "1px solid #444", background: uploadMode === "file" ? "rgba(255,215,0,0.1)" : "transparent", color: uploadMode === "file" ? "#FFD700" : "#d5d5d5", cursor: "pointer", transition: "all 0.2s", fontSize: "13px" }}>
                  <FileImage size={15} /> Upload from PC
                </button>
                <button className="start-btn" onClick={() => setUploadMode("qr")} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", borderRadius: "0", border: uploadMode === "qr" ? "1px solid rgba(255,215,0,0.3)" : "1px solid #444", background: uploadMode === "qr" ? "rgba(255,215,0,0.1)" : "transparent", color: uploadMode === "qr" ? "#FFD700" : "#d5d5d5", cursor: "pointer", transition: "all 0.2s", fontSize: "13px" }}>
                  <Scan size={15} /> Scan with Phone
                </button>
              </div>

              {uploadMode === "file" ? (
                <div 
                  className="hero-upload-box"
                  onDragOver={handleDragOver} 
                  onDrop={handleDrop}
                  style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: "0", background: "#222", border: "1px dashed #555" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <button className="start-btn" style={{ background: "#333", color: "#e0e0e0", border: "1px solid #555", borderRadius: "0", fontSize: "16px", padding: "16px 24px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontWeight: "normal", transition: "all 0.2s", pointerEvents: "none" }}>
                    <Monitor size={18} /> Select Image
                  </button>
                  <div style={{ marginTop: "15px", color: "#888", fontSize: "14px" }}>or drop an image</div>
                  <input type="file" ref={fileInputRef} onChange={(e) => handleFileSelected(e.target.files[0])} accept="image/*" style={{ display: "none" }} />
                </div>
              ) : (
                <div className="hero-upload-box" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: "0", background: "#222", border: "1px solid #444" }}>
                  <p style={{ color: "#aaa", margin: "0 0 20px 0", fontSize: "14px" }}>
                    Point your phone's camera at this QR code.
                  </p>
                  <div style={{ background: "#fff", padding: "20px", display: "inline-block", borderRadius: "0" }}>
                    <QRCode 
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/mobile?sync=${syncSessionId}`}
                      size={200} bgColor="#ffffff" fgColor="#000000" level="H"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "normal", margin: 0, color: "#fff" }}>Source Image</h3>
                <button className="start-btn" onClick={() => { setPreviewImage(null); setExtractedData(null); }} style={{ padding: "8px 16px", borderRadius: "0", background: "transparent", color: "#d5d5d5", border: "1px solid #555", cursor: "pointer", fontSize: "13px" }}>Upload Different Image</button>
              </div>
              <div style={{ flex: 1, background: "#1a1a1a", borderRadius: "0", border: "1px solid #444", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", position: "relative", minHeight: 0 }}>
                <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img src={previewImage} alt="Preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "0" }} />
                </div>
              </div>
              {!isProcessing && !extractedData && (
                <button 
                  className="start-btn" 
                  onClick={() => {
                    if (selectedFile) uploadAndProcessFile(selectedFile);
                    else if (selectedUrl) processOcrFromUrl(selectedUrl);
                  }} 
                  style={{ marginTop: "15px", borderRadius: "0", width: "100%", background: "#FFD700", color: "#000", border: "none", padding: "12px", fontWeight: "bold", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
                >
                  <Table2 size={18} /> Extract Data
                </button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Results */}
        <div style={{ flex: "0 0 50%", background: "#262626", padding: "40px", display: "flex", flexDirection: "column" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "normal", margin: 0, color: "#fff" }}>
              Extracted Data
            </h2>
            {extractedData && extractedData.length > 0 && (
              <button className="start-btn" onClick={handleDownloadCsv} style={{ padding: "10px 20px", borderRadius: "0", background: "#FFD700", color: "#000", fontWeight: "bold", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.2s" }}>
                <Download size={16} /> Download CSV
              </button>
            )}
          </div>

          <div style={{ flex: 1, background: "#1a1a1a", borderRadius: "0", border: "1px solid #444", overflow: "hidden", position: "relative" }}>
            {!previewImage ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "20px", overflowY: "auto" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "normal", color: "#aaa", margin: "0 0 20px 0", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #333", paddingBottom: "10px" }}>
                  <Clock size={16} /> Recent Extractions
                </h3>
                {recentExtractions.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#666" }}>
                    <Table2 size={48} style={{ marginBottom: "15px", opacity: 0.5 }} />
                    <p style={{ fontSize: "15px" }}>Upload an image to extract and save data.</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "15px" }}>
                    {recentExtractions.map(ext => (
                      <div key={ext.id} onClick={() => {
                        setPreviewImage(ext.original_image_url);
                        try { setExtractedData(JSON.parse(ext.svg_url)); } catch(e) {}
                      }} style={{ background: "#222", border: "1px solid #333", padding: "10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "10px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#333"}>
                        <div style={{ height: "100px", background: `url(${ext.original_image_url}) center/cover`, border: "1px solid #444" }}></div>
                        <p style={{ fontSize: "12px", color: "#aaa", margin: 0 }}>{new Date(ext.created_at).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : isProcessing ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(38,38,38,0.9)", zIndex: 5 }}>
                <Loader2 size={40} color="#FFD700" className="animate-spin" style={{ marginBottom: "20px" }} />
                <h3 style={{ margin: "0 0 10px 0", fontSize: "16px", fontWeight: "normal", color: "#fff" }}>Analyzing Image...</h3>
                <p style={{ color: "#aaa", margin: 0, fontSize: "14px", textAlign: "center" }}>
                  Gemini AI is reading your text...
                </p>
              </div>
            ) : extractedData && extractedData.length > 0 ? (
              <div style={{ height: "100%", overflow: "auto", padding: "20px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", textAlign: "left", color: "#d5d5d5" }}>
                  <thead style={{ position: "sticky", top: "-20px", background: "#1a1a1a", zIndex: 2 }}>
                    <tr>
                      {Object.keys(extractedData[0]).map((key, i) => (
                        <th key={key} style={{ padding: "12px 16px", color: "#FFD700", fontWeight: "normal", textTransform: "capitalize", borderBottom: "1px solid #444", whiteSpace: "nowrap" }}>
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {extractedData.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #333" }}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} style={{ padding: "12px 16px" }}>{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : extractedData && extractedData.length === 0 ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#ff4444" }}>
                <p style={{ fontSize: "15px" }}>No structured data could be extracted from this image.</p>
              </div>
            ) : null}
          </div>

        </div>
      </main>
      <TopUpModal show={showTopUpModal} onClose={() => setShowTopUpModal(false)} />
    </div>
  );
}

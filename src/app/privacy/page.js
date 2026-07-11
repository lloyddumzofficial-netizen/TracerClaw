"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, FileText, CheckCircle2 } from "lucide-react";
import "../globals.css";

export default function PrivacyPolicy() {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#111", color: "#eee", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ maxWidth: "800px", margin: "0 auto", paddingBottom: "20px", borderBottom: "1px solid #333" }}>
        <button 
          onClick={() => router.push('/')}
          style={{ display: "flex", alignItems: "center", gap: "8px", background: "transparent", color: "#aaa", border: "none", cursor: "pointer", padding: "0", fontSize: "14px", marginBottom: "30px", transition: "color 0.2s" }}
          onMouseEnter={(e) => e.currentTarget.style.color = "#FFD700"}
          onMouseLeave={(e) => e.currentTarget.style.color = "#aaa"}
        >
          <ArrowLeft size={16} /> Back to Home
        </button>
        <h1 style={{ fontSize: "36px", margin: "0 0 10px 0", color: "#fff", display: "flex", alignItems: "center", gap: "12px" }}>
          <Shield color="#FFD700" size={36} /> Privacy Policy & FAQ
        </h1>
        <p style={{ color: "#888", fontSize: "16px", margin: 0 }}>How we handle your data, images, and copyright.</p>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "50px" }}>
        
        {/* FAQ Section */}
        <section>
          <h2 style={{ fontSize: "24px", color: "#FFD700", marginBottom: "24px", display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle2 size={24} /> Frequently Asked Questions
          </h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
              <h3 style={{ margin: "0 0 10px 0", color: "#fff", fontSize: "18px" }}>What happens to the images I upload? Are they saved in your database?</h3>
              <p style={{ color: "#aaa", margin: 0, lineHeight: "1.6" }}>
                We deeply respect your privacy. Images uploaded to Auto-Tracer are processed temporarily to generate the vector output. Your project files are stored in your personal project history for your convenience, but are <strong style={{ color: "#ddd" }}>automatically and permanently deleted within 3 days</strong> via our automated cleanup system. We do not harvest, sell, or permanently archive user images.
              </p>
            </div>

            <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
              <h3 style={{ margin: "0 0 10px 0", color: "#fff", fontSize: "18px" }}>Who owns the copyright of the images I upload and convert?</h3>
              <p style={{ color: "#aaa", margin: 0, lineHeight: "1.6" }}>
                You do! You retain 100% full copyright and ownership of your original images and the resulting vector graphics. We do not claim any rights to your work.
              </p>
            </div>

            <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
              <h3 style={{ margin: "0 0 10px 0", color: "#fff", fontSize: "18px" }}>Do you use my images to train AI or sell them?</h3>
              <p style={{ color: "#aaa", margin: 0, lineHeight: "1.6" }}>
                Absolutely not. Your files are used solely for the tracing service you requested. We do not harvest, sell, share, or use your images to train AI models.
              </p>
            </div>
          </div>
        </section>

        {/* Privacy Policy Section */}
        <section>
          <h2 style={{ fontSize: "24px", color: "#FFD700", marginBottom: "24px", display: "flex", alignItems: "center", gap: "8px" }}>
            <FileText size={24} /> Official Privacy Policy
          </h2>
          
          <div style={{ color: "#ccc", lineHeight: "1.8", fontSize: "15px", background: "#1a1a1a", padding: "30px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
            <h3 style={{ color: "#fff", marginTop: "0", marginBottom: "15px", fontSize: "20px" }}>1. Data Collection and Image Processing</h3>
            <p>When you use Auto-Tracer to convert images, you upload media files to our servers. Please be assured of the following regarding your data:</p>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "12px", marginTop: "15px", marginBottom: "30px", color: "#aaa" }}>
              <li><strong style={{color: "#ddd"}}>Temporary Processing:</strong> We only process your uploaded images to perform the requested tracing or conversion service.</li>
              <li><strong style={{color: "#ddd"}}>Automatic Deletion (3-Day Retention):</strong> Your project files (original uploads, processed outputs, and vector files) are stored in your personal project history and automatically and permanently purged from our cloud storage within <strong style={{color: "#fff"}}>3 days</strong> of creation via our scheduled cleanup system. You may also delete your projects manually at any time for immediate deletion.</li>
              <li><strong style={{color: "#ddd"}}>Copyright and Ownership:</strong> You retain all copyrights and intellectual property rights to the images you upload and the resulting converted files. Auto-Tracer claims no ownership over your content.</li>
              <li><strong style={{color: "#ddd"}}>No Data Harvesting:</strong> We do not harvest, review, sell, or share your uploaded images with third parties. We do not use your personal images to train any artificial intelligence models.</li>
            </ul>

            <h3 style={{ color: "#fff", marginTop: "0", marginBottom: "15px", fontSize: "20px" }}>2. Authentication and Account Data</h3>
            <p style={{ color: "#aaa", marginBottom: "30px" }}>If you create an account using Google Auth, we store only the necessary information to maintain your session and manage your credits (e.g., your email address and profile name). We do not have access to your passwords. You can request account deletion at any time.</p>
            
            <h3 style={{ color: "#fff", marginTop: "0", marginBottom: "15px", fontSize: "20px" }}>3. Payments & Refunds</h3>
            <p style={{ color: "#aaa", marginBottom: "30px" }}>Auto-Tracer operates on a prepaid credit system. For full details on our credit refund rules and payment policies, please read our <a href="/refunds" style={{ color: "#FFD700" }}>Refund & Payment Policy</a>.</p>

            <h3 style={{ color: "#fff", marginTop: "0", marginBottom: "15px", fontSize: "20px" }}>4. Contact Us</h3>
            <p style={{ color: "#aaa", margin: 0 }}>If you have any questions or concerns about this Privacy Policy or how we handle your data, please reach out to us on our official Facebook page or contact channels.</p>
          </div>
        </section>

      </div>
    </div>
  );
}

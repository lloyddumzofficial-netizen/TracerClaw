"use client";

import { useEffect, useState } from "react";
import { Star, User } from "lucide-react";
import { safeJson } from "@/lib/safeJson";

export default function TestimonialSection() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        const res = await fetch("/api/reviews");
        const data = await safeJson(res, "Failed to load reviews");
        if (res.ok && data.success) {
          setReviews(data.reviews);
        }
      } catch (err) {
        console.error("Failed to load reviews", err);
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, []);

  if (loading || reviews.length === 0) return null;

  return (
    <div style={{ marginTop: '80px', marginBottom: '40px' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h3 style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>Community Trust</h3>
        <h2 style={{ color: "#fff", fontSize: "24px", margin: "8px 0 0 0", fontWeight: "700" }}>What our users say</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {reviews.map((rev, idx) => (
          <div key={idx} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {rev.reviewer_avatar ? (
                <img 
                  src={rev.reviewer_avatar} 
                  alt={rev.reviewer_name || "User"} 
                  referrerPolicy="no-referrer"
                  style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} 
                />
              ) : (
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={18} color="#aaa" />
                </div>
              )}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#eee' }}>{rev.reviewer_name || "DesaynClaw User"}</div>
                <div style={{ color: '#fbbf24', fontSize: '14px', letterSpacing: '1px' }}>
                  {'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}
                </div>
              </div>
            </div>
            
            <div style={{ fontSize: '14px', color: '#ccc', fontStyle: 'italic', lineHeight: '1.6' }}>
              "{rev.feedback_text}"
            </div>
            
          </div>
        ))}
      </div>
    </div>
  );
}

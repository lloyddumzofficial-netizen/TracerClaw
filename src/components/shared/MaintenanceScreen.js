"use client";
import { Monitor, Smartphone, QrCode, ArrowRight, Zap, RefreshCw, Server } from "lucide-react";

export default function MaintenanceScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a', // Deep background matching the app
      color: '#ffffff',
      fontFamily: 'var(--font-outfit), sans-serif',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '700px',
        width: '100%',
        background: '#121212', // Flat dark grey, no glassmorphism
        border: '1px solid #2a2a2a', // Solid minimal border
        padding: '50px',
        textAlign: 'left', // Left aligned for a more technical/detailed look
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          marginBottom: '40px',
          color: '#FFD700'
        }}>
          <div style={{ 
            background: '#1a1a1a', 
            border: '1px solid #333',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Smartphone size={32} strokeWidth={1.5} />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#666' }}>
            <div style={{ height: '1px', width: '30px', background: '#333' }}></div>
            <QrCode size={20} strokeWidth={1.5} />
            <div style={{ height: '1px', width: '30px', background: '#333' }}></div>
            <ArrowRight size={18} strokeWidth={1.5} />
          </div>

          <div style={{ 
            background: '#1a1a1a', 
            border: '1px solid #333',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Monitor size={32} strokeWidth={1.5} />
          </div>
        </div>

        <h1 style={{ 
          fontSize: '28px', 
          fontWeight: '600', 
          margin: '0 0 10px 0',
          textTransform: 'uppercase',
          letterSpacing: '1px'
        }}>
          System Upgrade in Progress
        </h1>
        
        <p style={{ fontSize: '15px', color: '#888', margin: '0 0 40px 0' }}>
          DesaynBro Auto-Tracer is temporarily offline for a scheduled core engine overhaul.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '40px' }}>
          <div style={{ display: 'flex', gap: '15px' }}>
            <Server size={20} color="#FFD700" style={{ marginTop: '2px' }} />
            <div>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', color: '#fff' }}>Surgical Extraction Mode</h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#888', lineHeight: '1.6' }}>
                We are implementing a massive upgrade to our AI's Content-Aware Fill. The system can now surgically erase typography, numbers, and sponsor logos while flawlessly reconstructing the underlying garment pattern with 98% accuracy.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            <Zap size={20} color="#FFD700" style={{ marginTop: '2px' }} />
            <div>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', color: '#fff' }}>Pipeline Optimization</h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#888', lineHeight: '1.6' }}>
                We have bypassed redundant upscaling layers. By utilizing native vector smoothing and compressing initial AI payloads, the overall generation time is cut in half without sacrificing HD pixel-perfect quality.
              </p>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '15px' }}>
            <RefreshCw size={20} color="#FFD700" style={{ marginTop: '2px' }} />
            <div>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', color: '#fff' }}>Smart Refund Protocol</h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#888', lineHeight: '1.6' }}>
                Upgraded our backend logic to ensure that 100% of failed generations or Google API timeouts are automatically refunded to your account credits.
              </p>
            </div>
          </div>
        </div>

        <div style={{
          background: '#1a1a1a',
          borderLeft: '4px solid #FFD700',
          padding: '20px',
          marginTop: '20px'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#FFD700', textTransform: 'uppercase' }}>
            Coming Soon: Mobile-to-PC Bridge
          </h4>
          <p style={{ margin: 0, fontSize: '14px', color: '#aaa', lineHeight: '1.5' }}>
            Say goodbye to transferring photos via email or Messenger. Once maintenance concludes, you will be able to simply scan a QR code on your PC monitor using your phone to instantly upload photos directly into your workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import styles from "./designExtract.module.css";
export default function WorkspaceNotice({ message, onDismiss, onRetry }) {
  const [closing,setClosing]=useState(false),[paused,setPaused]=useState(false);
  const [bottom,setBottom]=useState(112);
  useLayoutEffect(()=>{
    const dock=document.querySelector('[role="toolbar"][aria-label="Design editing tools"]');
    const measure=()=>setBottom(dock?Math.max(16,window.innerHeight-dock.getBoundingClientRect().top+16):56);
    const observer=new ResizeObserver(measure);if(dock)observer.observe(dock);window.addEventListener('resize',measure);measure();
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  const dismiss=useRef(onDismiss);dismiss.current=onDismiss;
  useEffect(()=>{
    if(paused||onRetry||closing)return;
    const timer=setTimeout(()=>setClosing(true),8000);return()=>clearTimeout(timer);
  },[paused,onRetry,closing]);
  useEffect(()=>{if(!closing)return;const timer=setTimeout(()=>dismiss.current(),220);return()=>clearTimeout(timer);},[closing]);
  return <div role="alert" className={styles.workspaceNotice} style={{bottom}} data-closing={closing} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocusCapture={()=>setPaused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPaused(false);}}>
    <CircleAlert size={16} aria-hidden="true"/><div><strong>Notice</strong><p>{message}</p>{onRetry&&<button onClick={onRetry}>Retry</button>}</div><button aria-label="Dismiss notification" onClick={()=>setClosing(true)}><X size={15}/></button>
  </div>;
}

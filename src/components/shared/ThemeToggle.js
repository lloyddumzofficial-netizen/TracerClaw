"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("desaynclaw-theme") || "dark";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("desaynclaw-theme", next);
  };

  if (!mounted) return <div className="theme-toggle-track" aria-hidden />;

  const isLight = theme === "light";

  return (
    <button
      className={`theme-toggle-track${isLight ? " is-light" : ""}`}
      onClick={toggle}
      title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
      aria-label="Toggle theme"
      aria-pressed={isLight}
    >
      <span className="theme-toggle-icon theme-toggle-moon">
        <Moon size={9} strokeWidth={2.5} />
      </span>
      <span className="theme-toggle-knob" />
      <span className="theme-toggle-icon theme-toggle-sun">
        <Sun size={9} strokeWidth={2.5} />
      </span>
    </button>
  );
}

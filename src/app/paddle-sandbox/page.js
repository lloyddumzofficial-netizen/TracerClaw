"use client";

import Script from "next/script";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { POLAR_CREDIT_PLANS } from "@/lib/paymentPlans";

const token = process.env.NEXT_PUBLIC_PADDLE_SANDBOX_CLIENT_TOKEN;

export default function PaddleSandbox() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState("");
  const [message, setMessage] = useState("");

  async function request(body) {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session) throw new Error("Sign in with the designated sandbox test account.");
    const response = await fetch("/api/payments/paddle/sandbox", {
      method: "POST",
      headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  async function run(action) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (process.env.NODE_ENV !== "development" || !token?.startsWith("test_")) {
    return <main className="p-8">Paddle Sandbox is unavailable.</main>;
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        onReady={() => {
          if (!window.Paddle.Initialized) {
            window.Paddle.Environment.set("sandbox");
            window.Paddle.Initialize({ token });
          }
          setTransactionId(window.sessionStorage.getItem("paddle-sandbox-transaction") || "");
          setReady(true);
        }}
        onError={() => setMessage("Could not load Paddle Checkout.")}
      />
      <h1 className="text-xl font-semibold">Paddle Sandbox checkout</h1>
      {Object.entries(POLAR_CREDIT_PLANS).map(([key, pack]) => (
        <button key={key} type="button" className="block rounded border-2 border-[#333333] p-2"
          disabled={!ready || busy} onClick={() => run(async () => {
            const { transactionId: id } = await request({ action: "checkout", plan: key });
            window.sessionStorage.setItem("paddle-sandbox-transaction", id);
            setTransactionId(id);
            window.Paddle.Checkout.open({ transactionId: id, settings: { allowDiscountRemoval: false, showAddDiscounts: false } });
          })}>
          {pack.label} · {pack.credits} Claws · {pack.price}
        </button>
      ))}
      <button type="button" className="rounded border-2 border-[#333333] p-2"
        disabled={!transactionId || busy} onClick={() => run(async () => {
          const result = await request({ action: "fulfill", transactionId });
          setMessage(result.status === "completed"
            ? result.granted ? `${result.credits} sandbox Claws credited.` : "Sandbox Claws were already credited."
            : `Payment status: ${result.status}. Check again after completing checkout.`);
        })}>
        Verify test payment
      </button>
      <p role="status">{message}</p>
    </main>
  );
}

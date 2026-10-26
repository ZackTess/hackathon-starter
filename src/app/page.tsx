"use client";

import { useState } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setOutput("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setOutput(data.output);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">App Name</h1>
      <p className="mt-2 text-neutral-500">One line on what this does.</p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste or type something..."
        rows={6}
        className="mt-8 w-full rounded-lg border border-neutral-300 bg-transparent p-3 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />

      <button
        onClick={run}
        disabled={loading || !input.trim()}
        className="mt-3 rounded-lg bg-black px-5 py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {loading ? "Thinking..." : "Run"}
      </button>

      {error && <p className="mt-6 text-red-500">{error}</p>}

      {output && (
        <div className="mt-6 whitespace-pre-wrap rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          {output}
        </div>
      )}
    </main>
  );
}

import { useState } from "react";
import { api, ApiError, type ChatTrace } from "../api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ChatTrace[];
}

export function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="stack">
      <div>
        <h1>Chat</h1>
        <p className="lede">The assistant calls gateway tools as you. Those calls show up in the audit log under your user.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="chat">
        {turns.map((turn, index) => (
          <div className={`bubble ${turn.role}`} key={index}>
            <div>{turn.content}</div>
            {turn.toolCalls?.length ? (
              <div className="trace">
                {turn.toolCalls.map((call, callIndex) => (
                  <div key={callIndex}>
                    <code>{call.name}</code> {call.isError ? <span className="error">failed</span> : <span className="muted">called</span>}
                    <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          const text = message.trim();
          if (!text) return;
          const history = turns.map((turn) => ({ role: turn.role, content: turn.content }));
          setTurns((current) => [...current, { role: "user", content: text }]);
          setMessage("");
          setBusy(true);
          setError("");
          api.chat(text, history).then((result) => {
            setTurns((current) => [...current, { role: "assistant", content: result.message, toolCalls: result.toolCalls }]);
          }).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : "Chat failed");
          }).finally(() => setBusy(false));
        }}
      >
        <label>Message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Create a product called Running Shoes for 49.00" />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Working…" : "Send"}</button>
      </form>
    </div>
  );
}

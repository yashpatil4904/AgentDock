import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, type ChatTrace } from "../api";
import { formatReply } from "../formatReply";

interface Turn {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ChatTrace[];
}

function argumentRows(value: unknown): Array<{ key: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (item === undefined || item === null || item === "") return [];
    return [{ key, value: typeof item === "string" ? item : JSON.stringify(item) }];
  });
}

function ToolCalls({ calls }: { calls: ChatTrace[] }) {
  const label = calls.length === 1 ? `Used ${calls[0]?.name}` : `Used ${calls.length} tools`;
  return (
    <details className="trace">
      <summary>{label}</summary>
      <div className="tool-list">
        {calls.map((call, index) => {
          const rows = argumentRows(call.arguments);
          return (
            <div className="tool-call" key={index}>
              <div className="tool-name">
                <code>{call.name}</code>
                {call.isError ? <span className="error">failed</span> : null}
              </div>
              {rows.length ? (
                <dl>
                  {rows.map((row) => (
                    <div key={row.key}>
                      <dt>{row.key}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
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
            {turn.role === "assistant" ? (
              <div className="md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatReply(turn.content)}</ReactMarkdown>
              </div>
            ) : (
              <div className="plain">{turn.content}</div>
            )}
            {turn.toolCalls?.length ? <ToolCalls calls={turn.toolCalls} /> : null}
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

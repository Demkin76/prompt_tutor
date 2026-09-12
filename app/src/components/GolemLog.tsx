import { useEffect, useRef } from "react";
import type { LogLine } from "../log";
import { pad } from "../log";

export function GolemLog({ lines, emptyText = "The golem waits for orders..." }: { lines: LogLine[]; emptyText?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div className="panel dark">
      <h2>Golem Log</h2>
      <div className="log" ref={ref}>
        {lines.length === 0 && <div className="empty">{emptyText}</div>}
        {lines.map((l) => (
          <div className="line" key={l.key}>
            <span className="tick">[{pad(l.tick)}]</span> <span className={l.kind}>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

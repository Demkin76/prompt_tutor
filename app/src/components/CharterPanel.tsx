interface EditableProps {
  value: string;
  budget: number;
  onChange: (v: string) => void;
  onDeploy: () => void;
  deploying?: boolean;
}

export function CharterEditor({ value, budget, onChange, onDeploy, deploying }: EditableProps) {
  const over = value.length > budget;
  const empty = value.trim().length === 0;
  return (
    <div className="panel charter">
      <h2>Golem Charter</h2>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write the golem's charter. Example: Explore carefully. Never step on red tiles. Pick up planks and use them to bridge red floor. Head for the altar."
        spellCheck={false}
      />
      <div className={`counter ${over ? "over" : ""}`}>
        <span>{over ? "OVER BUDGET" : "CHARACTERS"}</span>
        <span>
          {value.length}/{budget}
        </span>
      </div>
      <button className="btn primary big" disabled={empty || over || deploying} onClick={onDeploy}>
        {deploying ? "Deploying..." : "Deploy"}
      </button>
      <div className="hint">The golem will read the charter and act.</div>
    </div>
  );
}

export function CharterLocked({ value, budget }: { value: string; budget?: number }) {
  return (
    <div className="panel charter">
      <h2>
        <span className="lock">
          <span aria-hidden>{"🔒"}</span> Golem Charter
        </span>
      </h2>
      <pre className="locked">{value}</pre>
      <div className="counter">
        <span>LOCKED</span>
        <span>
          {value.length}
          {budget ? `/${budget}` : ""}
        </span>
      </div>
    </div>
  );
}

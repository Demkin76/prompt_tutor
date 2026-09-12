interface EditableProps {
  value: string;
  budget: number;
  onChange: (v: string) => void;
  onDeploy: () => void;
  deploying?: boolean;
  keymaster?: boolean;
}

export function CharterEditor({ value, budget, onChange, onDeploy, deploying, keymaster }: EditableProps) {
  const over = value.length > budget;
  const empty = value.trim().length === 0;
  return (
    <div className="panel charter">
      <h2>{keymaster ? "Устав голема" : "Golem Charter"}</h2>
      <textarea
        aria-label={keymaster ? "Устав голема" : "Golem Charter"}
        disabled={deploying}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={keymaster ? "Если путь к цели заблокирован, найди способ устранить препятствие. Используй полезные предметы." : "Write the golem's charter. Explore carefully. Head for the altar."}
        spellCheck={false}
      />
      <div className={`counter ${over ? "over" : ""}`}>
        <span>{over ? "OVER BUDGET" : "CHARACTERS"}</span>
        <span>
          {value.length}/{budget}
        </span>
      </div>
      <button className="btn primary big" disabled={empty || over || deploying} onClick={onDeploy}>
        {deploying ? "Оживление..." : keymaster ? "Оживить" : "Deploy"}
      </button>
      <div className="hint">{keymaster ? "После оживления устав нельзя изменить до конца попытки." : "The golem will read the charter and act."}</div>
    </div>
  );
}

export function CharterLocked({ value, budget, keymaster }: { value: string; budget?: number; keymaster?: boolean }) {
  return (
    <div className="panel charter">
      <h2>
        <span className="lock">
          <span aria-hidden>{"🔒"}</span> {keymaster ? "Устав голема" : "Golem Charter"}
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

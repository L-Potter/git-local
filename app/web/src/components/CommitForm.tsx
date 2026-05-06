import { useState } from "react";

type Props = {
  branch: string;
  count: number;
  disabled?: boolean;
  onCommit: (message: string) => void;
};

export function CommitForm({ branch, count, disabled, onCommit }: Props) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    const msg = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim();
    if (!msg) return;
    onCommit(msg);
    setSummary("");
    setDescription("");
  };

  const canCommit = !!summary.trim() && count > 0 && !disabled;

  return (
    <div className="commit-form">
      <input
        className="summary"
        placeholder="Summary (required)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        disabled={disabled}
      />
      <textarea
        className="description"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        disabled={disabled}
      />
      <button className="commit-btn" disabled={!canCommit} onClick={submit}>
        Commit {count > 0 ? `${count} file${count === 1 ? "" : "s"} ` : ""}to{" "}
        <span className="commit-branch">{branch}</span>
      </button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, message } from "./api";
import "./reviewer-login.css";

export function ReviewerLogin({ busy, onAuthenticate }: { busy: boolean; onAuthenticate: (credentials: { username: string; password: string }) => Promise<void> }) {
  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const request = new AbortController();
    void api<{ enabled: boolean }>("/auth/reviewer/config", { signal: request.signal })
      .then((config) => { if (!request.signal.aborted) setEnabled(config.enabled); })
      .catch((cause) => { if (!request.signal.aborted) setError(message(cause)); });
    return () => request.abort();
  }, []);
  if (!enabled) return error ? <p className="config-note" role="status">访问入口检查失败：{error}</p> : null;
  return <form className="reviewer-login" onSubmit={(event) => { event.preventDefault(); if (!busy && username.trim() && password) void onAuthenticate({ username: username.trim(), password }); }}>
    <div className="login-divider"><span>受邀访问</span></div>
    <label className="reviewer-field">账号<input name="username" autoComplete="username" maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)}/></label>
    <label className="reviewer-field">密码<input name="password" type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
    <button className="button secondary" type="submit" disabled={busy || !username.trim() || !password}>{busy ? "正在登录…" : "使用访问账号登录"}</button>
  </form>;
}

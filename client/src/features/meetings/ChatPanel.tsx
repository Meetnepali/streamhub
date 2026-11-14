import { FileText, Paperclip, Send, Smile, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import type { MeetingClient } from './MeetingClient';
import type { ChatMessage } from './types';

const EMOJIS = ['👍', '👏', '😂', '❤️', '🎉', '😮', '😢', '🙏', '🔥', '✅', '👋', '🤔', '😄', '💯', '🙌', '👀'];
const MAX_FILE = 25 * 1024 * 1024;

export function ChatPanel({
  client,
  messages,
  selfUserId,
  canChat,
  onClose,
}: {
  client: MeetingClient;
  messages: ChatMessage[];
  selfUserId: string;
  canChat: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;
    setError('');
    try {
      await client.sendChat(content);
      setText('');
      setEmojiOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE) return setError('Files can be up to 25 MB');
    setBusy(true);
    setError('');
    try {
      await client.sendFile(file);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <aside className="side-panel">
      <header>
        <h3>In-call chat</h3>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close chat"><X size={16} /></button>
      </header>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="subtle" style={{ textAlign: 'center', marginTop: 24 }}>No messages yet. Say hi 👋</p>}
        {messages.map((m) => {
          const mine = m.userId === selfUserId;
          const emojiOnly = m.kind === 'text' && /^(\p{Extended_Pictographic}|️|‍|\s){1,6}$/u.test(m.content);
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
              <div className="chat-meta">
                {mine ? 'You' : m.userName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              {m.kind === 'file' ? (
                <a className="chat-file" href={m.fileUrl ?? '#'} download={m.fileName ?? true}>
                  <FileText size={18} />
                  <span>
                    <strong>{m.fileName}</strong>
                    <small>{formatBytes(m.fileSize ?? 0)}</small>
                  </span>
                </a>
              ) : (
                <div className={`chat-bubble ${emojiOnly ? 'emoji-only' : ''}`}>{m.content}</div>
              )}
            </div>
          );
        })}
      </div>
      {error && <div className="alert error" style={{ margin: '0 12px 8px' }}>{error}</div>}
      {canChat ? (
        <form className="chat-compose" onSubmit={send}>
          {emojiOpen && (
            <div className="emoji-picker">
              {EMOJIS.map((e) => (
                <button type="button" key={e} onClick={() => setText((t) => t + e)}>{e}</button>
              ))}
            </div>
          )}
          <button type="button" className="btn ghost icon sm" onClick={() => setEmojiOpen((o) => !o)} aria-label="Emoji"><Smile size={18} /></button>
          <button type="button" className="btn ghost icon sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach file"><Paperclip size={18} /></button>
          <input ref={fileRef} type="file" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={busy ? 'Uploading…' : 'Send a message'}
            maxLength={2000}
          />
          <button className="btn primary icon sm" disabled={!text.trim()} aria-label="Send"><Send size={16} /></button>
        </form>
      ) : (
        <p className="subtle chat-disabled">The host has turned off chat for you.</p>
      )}
    </aside>
  );
}

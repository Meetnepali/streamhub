import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { api } from '../../lib/api';

interface MentionUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

const MAX = 2000;

export function Composer({
  initialValue = '',
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  autoFocus,
  onSubmit,
  onCancel,
  alwaysExpanded,
}: {
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Resolve true to clear the box. */
  onSubmit: (content: string) => Promise<boolean>;
  onCancel?: () => void;
  alwaysExpanded?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(!!autoFocus);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [autoFocus]);

  // Auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  // Debounced @mention lookup
  useEffect(() => {
    if (query === null || query.length < 1) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get<{ items: MentionUser[] }>(`/users/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => {
          setSuggestions(r.items);
          setActive(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  function updateMentionQuery(text: string, caret: number) {
    const m = /(?:^|[^\w@])@([a-zA-Z0-9_.]{0,30})$/.exec(text.slice(0, caret));
    setQuery(m ? m[1] : null);
  }

  function insertMention(username: string) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([a-zA-Z0-9_.]{0,30})$/, `@${username} `);
    const next = before + value.slice(caret);
    setValue(next);
    setQuery(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  async function submit() {
    const content = value.trim();
    if (!content || busy || content.length > MAX) return;
    setBusy(true);
    try {
      if (await onSubmit(content)) {
        setValue('');
        if (!alwaysExpanded) setFocused(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const expanded = alwaysExpanded || focused || value.length > 0;
  const showSuggestions = query !== null && suggestions.length > 0;

  return (
    <div className="cm-composer">
      <div style={{ position: 'relative' }}>
        <textarea
          ref={ref}
          className="textarea cm-textarea"
          rows={1}
          placeholder={placeholder}
          value={value}
          maxLength={MAX + 200}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setValue(e.target.value);
            updateMentionQuery(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => updateMentionQuery(value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={(e) => {
            if (showSuggestions) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => (a + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(suggestions[active].username);
                return;
              }
              if (e.key === 'Escape') {
                setQuery(null);
                return;
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
        {showSuggestions && (
          <ul className="cm-mentions" role="listbox">
            {suggestions.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u.username);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Avatar name={u.name} src={u.avatarUrl} size={24} />
                <span style={{ fontWeight: 600 }}>@{u.username}</span>
                <span className="subtle">{u.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {expanded && (
        <div className="row cm-composer-actions">
          <span className={`subtle ${value.length > MAX ? 'cm-over' : ''}`}>
            {value.length > MAX * 0.8 ? `${value.length}/${MAX}` : 'Tip: type @ to mention someone · Ctrl+Enter to post'}
          </span>
          <div className="spacer" />
          <button
            className="btn ghost sm"
            onClick={() => {
              setValue(initialValue);
              setFocused(false);
              onCancel?.();
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn primary sm"
            onClick={() => void submit()}
            disabled={busy || !value.trim() || value.length > MAX || value.trim() === initialValue.trim()}
          >
            {busy ? 'Posting…' : submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

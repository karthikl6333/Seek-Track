import { useState } from 'react';
import type { Store } from '../hooks/useStore';

export function Journal({ store }: { store: Store }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [symbol, setSymbol] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const submit = async () => {
    if (!title.trim()) return;
    await store.saveJournal({
      id: crypto.randomUUID(),
      date,
      symbol: symbol.trim().toUpperCase() || undefined,
      title: title.trim(),
      body: body.trim(),
      createdAt: new Date().toISOString(),
    });
    setTitle('');
    setBody('');
    setSymbol('');
  };

  return (
    <div className="content-split">
      <div className="card">
        <h3>New Journal Entry</h3>
        <div className="grid-2">
          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Symbol (optional)</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <button type="button" className="btn primary" onClick={() => void submit()}>
          Save entry
        </button>
      </div>
      <div className="stack">
        {store.journal.map((e) => (
          <div className="card" key={e.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <strong>{e.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {e.date}
                  {e.symbol ? ` · ${e.symbol}` : ''}
                </div>
              </div>
              <button type="button" className="btn small ghost" onClick={() => void store.removeJournal(e.id)}>
                Delete
              </button>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{e.body}</p>
          </div>
        ))}
        {store.journal.length === 0 && (
          <div className="card muted">No journal entries yet.</div>
        )}
      </div>
    </div>
  );
}

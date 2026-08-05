import React, { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Without a boundary, any render error unmounts the whole React tree and the
// window goes blank. This keeps the app usable and surfaces the error instead.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[tapin] render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 40, background: '#020617', color: '#e2e8f0', fontFamily: 'sans-serif', textAlign: 'center' }}>
          <div>
            <h1 style={{ fontSize: 26, marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ color: '#f43f5e', fontFamily: 'monospace', fontSize: 13, maxWidth: 640, wordBreak: 'break-word' }}>
              {String(this.state.error.message || this.state.error)}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ marginTop: 20, padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', background: '#10b981', color: '#022c22', fontWeight: 600, fontSize: 14 }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

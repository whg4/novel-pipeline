import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: 40, textAlign: 'center', maxWidth: 500, margin: '80px auto',
          border: '1px solid #eaeaea', background: '#fafafa',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#171717' }}>
            页面出现错误
          </h2>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '8px 20px', background: '#000', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            刷新页面
          </button>
          <p style={{ fontSize: 11, color: '#bbb', marginTop: 12 }}>
            数据已保存在浏览器本地，刷新后不会丢失
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

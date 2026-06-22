import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

/**
 * 顶层 Error Boundary。
 * 捕获 React 渲染期间的未处理异常，防止整棵树崩溃后显示白屏/黑屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] 未捕获的渲染错误:", error, info.componentStack);
    this.setState({ stack: info.componentStack });
  }

  handleReset = () => {
    this.setState({ error: null, stack: null });
    window.location.hash = "#/";
  };

  render() {
    if (this.state.error) {
      const { error, stack } = this.state;
      const detail = stack
        ? `${error.message}\n\n—— 组件栈 ——\n${stack.trim()}`
        : error.message;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "var(--color-bg, #1e1e2e)",
            color: "var(--color-text, #e2e8f0)",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px" }}>应用发生错误</h2>
          <pre
            style={{
              maxWidth: "600px",
              maxHeight: "200px",
              overflow: "auto",
              fontSize: "12px",
              color: "var(--color-text-secondary, #a0aec0)",
              background: "var(--color-bg-tertiary, #2d2d44)",
              padding: "12px 16px",
              borderRadius: "8px",
              margin: "8px 0 16px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {detail}
          </pre>
          <button
            onClick={this.handleReset}
            style={{
              padding: "8px 20px",
              fontSize: "14px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              background: "var(--color-accent, #60a5fa)",
              color: "#fff",
            }}
          >
            回到首页
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

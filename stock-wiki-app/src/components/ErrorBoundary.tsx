import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center">
              <p className="text-red-500 font-semibold mb-2">Component Error</p>
              <pre className="text-xs text-[var(--color-text-muted)] max-w-md whitespace-pre-wrap">
                {this.state.error}
              </pre>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

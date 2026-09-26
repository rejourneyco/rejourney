import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackClassName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;
      const message = isDev
        ? this.state.error?.message || 'An unexpected error occurred'
        : 'An unexpected error occurred. Please reload the page or contact support if it keeps happening.';
      const fallbackClassName = this.props.fallbackClassName || 'min-h-screen flex items-center justify-center bg-background p-8';

      return (
        <div className={fallbackClassName}>
          <div className="max-w-md w-full">
            <div className="rounded-none border border-[#dadce0] bg-white p-6 shadow-[0_1px_3px_rgba(60,64,67,0.12)]">
              <h1 className="mb-2 text-xl font-normal text-[#202124]">Something went wrong</h1>
              <p className="mb-4 text-sm text-[#5f6368]">
                {message}
              </p>
              {isDev && this.state.error?.stack && (
                <details className="mb-4 text-xs text-[#5f6368]">
                  <summary className="mb-2 cursor-pointer">Error details (dev only)</summary>
                  <pre className="whitespace-pre-wrap rounded-none bg-[#f8fafd] p-2">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="rounded-none bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1765cc]"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

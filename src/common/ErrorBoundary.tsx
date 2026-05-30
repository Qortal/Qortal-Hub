import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode | ((args: { error: Error | null; componentStack?: string }) => ReactNode);
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true, error: _ };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({
      componentStack: errorInfo.componentStack,
      error,
    });
    console.error('Error caught in ErrorBoundary:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          componentStack: this.state.componentStack,
        });
      }

      return this.props.fallback;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

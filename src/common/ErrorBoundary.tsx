import React, { ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // You can log the error and errorInfo here, for example, to an error reporting service.
    console.error('Error caught in ErrorBoundary:', error, errorInfo)
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback

    return this.props.children
  }
}

export default ErrorBoundary

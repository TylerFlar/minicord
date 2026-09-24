import { Component, type ErrorInfo, type ReactNode } from "react";

/** A screen that throws shows this instead of taking the whole window down with it. */
export class ErrorBoundary extends Component<{ children: ReactNode; onHome?: () => void }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("screen crashed", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex flex-1 items-center justify-center bg-surface p-6">
        <div className="max-w-sm text-center">
          <div className="text-[17px] font-semibold">Something broke here</div>
          <div className="mt-1 break-words text-[13px] text-muted">{error.message}</div>
          <div className="mt-4 flex justify-center gap-2">
            {this.props.onHome && (
              <button
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onHome?.();
                }}
                className="rounded-md bg-sunken px-3 py-1.5 text-[14px] font-medium hover:bg-line"
              >
                Go to Inbox
              </button>
            )}
            <button onClick={() => location.reload()} className="rounded-md bg-accent px-3 py-1.5 text-[14px] font-medium text-on-accent hover:opacity-90">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
